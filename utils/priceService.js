// utils/priceService.js
const axios = require('axios');
const cache = require('../db/cache');
const CryptoPrice = require('../api/v1/models/cryptoPrice');

// Supported symbols mapped to CoinGecko IDs
const SYMBOL_TO_COINGECKO = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  USDT: 'tether',
  USDC: 'usd-coin',
  BNB: 'binancecoin',
  SOL: 'solana',
  XRP: 'ripple',
  ADA: 'cardano',
  DOGE: 'dogecoin',
  TRX: 'tron',
  MATIC: 'matic-network',
  LTC: 'litecoin',
};

// Fallback prices (used if API completely fails and DB has no data)
const FALLBACK_PRICES = {
  BTC: 67420.50,
  ETH: 3245.80,
  USDT: 1.00,
  USDC: 1.00,
  BNB: 598.40,
  SOL: 168.90,
  XRP: 0.62,
  ADA: 0.45,
  DOGE: 0.16,
  TRX: 0.13,
  MATIC: 0.89,
  LTC: 85.30,
};

const CACHE_KEY = 'crypto_prices';
const CACHE_TTL = 60; // seconds
const COINGECKO_API = 'https://api.coingecko.com/api/v3';

/*
|--------------------------------------------------------------------------
| FETCH FROM COINGECKO
|--------------------------------------------------------------------------
*/
const fetchFromCoinGecko = async (symbols) => {
  const ids = symbols
    .map(s => SYMBOL_TO_COINGECKO[s.toUpperCase()])
    .filter(Boolean)
    .join(',');

  if (!ids) return {};

  const url = `${COINGECKO_API}/simple/price`;

  const { data } = await axios.get(url, {
    params: {
      ids,
      vs_currencies: 'usd',
      include_24hr_change: true,
      include_market_cap: true,
      include_24hr_vol: true,
    },
    timeout: 10000,
    headers: {
      Accept: 'application/json',
    },
  });

  const prices = {};
  for (const [symbol, cgId] of Object.entries(SYMBOL_TO_COINGECKO)) {
    if (data[cgId]) {
      prices[symbol] = {
        symbol,
        usdPrice: data[cgId].usd,
        change24h: data[cgId].usd_24h_change || 0,
        marketCap: data[cgId].usd_market_cap || 0,
        volume24h: data[cgId].usd_24h_vol || 0,
      };
    }
  }

  return prices;
};

/*
|--------------------------------------------------------------------------
| UPDATE DB WITH FETCHED PRICES
|--------------------------------------------------------------------------
*/
const persistPricesToDB = async (prices) => {
  const ops = [];

  for (const [symbol, info] of Object.entries(prices)) {
    ops.push({
      updateOne: {
        filter: { symbol },
        update: {
          $set: {
            symbol: info.symbol,
            name: getCryptoName(symbol),
            usdPrice: info.usdPrice,
            change24h: info.change24h,
            marketCap: info.marketCap,
            volume24h: info.volume24h,
            source: 'coingecko',
            lastUpdated: new Date(),
          },
          $setOnInsert: {
            isManualOverride: false,
          },
        },
        upsert: true,
      },
    });
  }

  if (ops.length > 0) {
    await CryptoPrice.bulkWrite(ops);
  }
};

/*
|--------------------------------------------------------------------------
| GET ALL PRICES (main entry point)
| Strategy:
|   1. Check in-memory cache → fastest
|   2. Fetch fresh from CoinGecko → update DB
|   3. Fall back to DB values (admin overrides + last known)
|   4. Hardcoded defaults as last resort
|--------------------------------------------------------------------------
*/
const getAllPrices = async (forceRefresh = false) => {
  const symbols = Object.keys(SYMBOL_TO_COINGECKO);

  // 1. Cache hit
  if (!forceRefresh) {
    const cached = cache.get(CACHE_KEY);
    if (cached) return cached;
  }

  let prices = null;

  // 2. Try fresh fetch
  try {
    const freshPrices = await fetchFromCoinGecko(symbols);

    if (Object.keys(freshPrices).length > 0) {
      await persistPricesToDB(freshPrices);
      prices = freshPrices;
    }
  } catch (err) {
    console.warn('⚠️ CoinGecko fetch failed:', err.message);
  }

  // 3. If fetch failed, use DB values (respecting admin overrides)
  if (!prices) {
    const dbPrices = await CryptoPrice.find();
    prices = {};

    for (const p of dbPrices) {
      prices[p.symbol] = {
        symbol: p.symbol,
        usdPrice: p.isManualOverride && p.overridePrice !== null
          ? p.overridePrice
          : p.usdPrice,
        change24h: p.change24h,
        marketCap: p.marketCap,
        volume24h: p.volume24h,
        source: p.isManualOverride ? 'manual' : p.source,
      };
    }

    // Fill missing with fallbacks
    for (const symbol of symbols) {
      if (!prices[symbol]) {
        prices[symbol] = {
          symbol,
          usdPrice: FALLBACK_PRICES[symbol] || 0,
          change24h: 0,
          marketCap: 0,
          volume24h: 0,
          source: 'fallback',
        };
      }
    }
  } else {
    // Even on success, apply admin overrides for currencies that have them
    const overrides = await CryptoPrice.find({ isManualOverride: true });
    for (const o of overrides) {
      if (prices[o.symbol] && o.overridePrice !== null) {
        prices[o.symbol].usdPrice = o.overridePrice;
        prices[o.symbol].source = 'manual';
      }
    }
  }

  // 4. Cache result
  cache.set(CACHE_KEY, prices, CACHE_TTL);

  return prices;
};

/*
|--------------------------------------------------------------------------
| GET SINGLE PRICE
|--------------------------------------------------------------------------
*/
const getPrice = async (symbol) => {
  const symbolUpper = symbol.toUpperCase().trim();
  const prices = await getAllPrices();
  return prices[symbolUpper] || null;
};

/*
|--------------------------------------------------------------------------
| CONVERT USD → CRYPTO
|--------------------------------------------------------------------------
*/
const usdToCrypto = async (usdAmount, symbol) => {
  const price = await getPrice(symbol);
  if (!price || price.usdPrice <= 0) {
    throw new Error(`Price unavailable for ${symbol}`);
  }

  return {
    symbol: symbol.toUpperCase(),
    amountUSD: parseFloat(usdAmount),
    amountCrypto: parseFloat((usdAmount / price.usdPrice).toFixed(8)),
    price: price.usdPrice,
    source: price.source,
  };
};

/*
|--------------------------------------------------------------------------
| CONVERT CRYPTO → USD
|--------------------------------------------------------------------------
*/
const cryptoToUsd = async (cryptoAmount, symbol) => {
  const price = await getPrice(symbol);
  if (!price || price.usdPrice <= 0) {
    throw new Error(`Price unavailable for ${symbol}`);
  }

  return {
    symbol: symbol.toUpperCase(),
    amountCrypto: parseFloat(cryptoAmount),
    amountUSD: parseFloat((cryptoAmount * price.usdPrice).toFixed(2)),
    price: price.usdPrice,
    source: price.source,
  };
};

/*
|--------------------------------------------------------------------------
| GET PRICES FOR MULTIPLE SYMBOLS
|--------------------------------------------------------------------------
*/
const getPricesForSymbols = async (symbols) => {
  const allPrices = await getAllPrices();
  const result = {};

  for (const symbol of symbols) {
    const s = symbol.toUpperCase().trim();
    if (allPrices[s]) {
      result[s] = allPrices[s];
    }
  }

  return result;
};

/*
|--------------------------------------------------------------------------
| HELPER: GET CRYPTO NAME
|--------------------------------------------------------------------------
*/
const getCryptoName = (symbol) => {
  const names = {
    BTC: 'Bitcoin',
    ETH: 'Ethereum',
    USDT: 'Tether USD',
    USDC: 'USD Coin',
    BNB: 'Binance Coin',
    SOL: 'Solana',
    XRP: 'Ripple',
    ADA: 'Cardano',
    DOGE: 'Dogecoin',
    TRX: 'TRON',
    MATIC: 'Polygon',
    LTC: 'Litecoin',
  };
  return names[symbol.toUpperCase()] || symbol;
};

/*
|--------------------------------------------------------------------------
| FORCE REFRESH (admin)
|--------------------------------------------------------------------------
*/
const forceRefresh = async () => {
  cache.delete(CACHE_KEY);
  return await getAllPrices(true);
};

/*
|--------------------------------------------------------------------------
| SET MANUAL OVERRIDE (admin)
|--------------------------------------------------------------------------
*/
const setManualPrice = async (symbol, price) => {
  const symbolUpper = symbol.toUpperCase().trim();

  const doc = await CryptoPrice.findOneAndUpdate(
    { symbol: symbolUpper },
    {
      $set: {
        symbol: symbolUpper,
        name: getCryptoName(symbolUpper),
        overridePrice: price,
        isManualOverride: true,
        source: 'manual',
        lastUpdated: new Date(),
      },
      $setOnInsert: {
        usdPrice: price,
        change24h: 0,
        marketCap: 0,
        volume24h: 0,
      },
    },
    { upsert: true, new: true }
  );

  cache.delete(CACHE_KEY);
  return doc;
};

/*
|--------------------------------------------------------------------------
| CLEAR MANUAL OVERRIDE (admin)
|--------------------------------------------------------------------------
*/
const clearManualPrice = async (symbol) => {
  const symbolUpper = symbol.toUpperCase().trim();

  const doc = await CryptoPrice.findOneAndUpdate(
    { symbol: symbolUpper },
    {
      $set: {
        overridePrice: null,
        isManualOverride: false,
        source: 'coingecko',
        lastUpdated: new Date(),
      },
    },
    { new: true }
  );

  cache.delete(CACHE_KEY);
  return doc;
};

module.exports = {
  getAllPrices,
  getPrice,
  usdToCrypto,
  cryptoToUsd,
  getPricesForSymbols,
  forceRefresh,
  setManualPrice,
  clearManualPrice,
  SYMBOL_TO_COINGECKO,
  FALLBACK_PRICES,
};