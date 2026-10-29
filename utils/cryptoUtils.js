// utils/priceService.js
const axios = require('axios');

// ─────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────
const CACHE_TTL_MS = 60_000; // 60 seconds
const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';
const COINCAP_BASE = 'https://api.coincap.io/v2';

/**
 * Map our currency codes → CoinGecko IDs
 * (CoinGecko uses full names like 'bitcoin' not 'BTC')
 */
const COINGECKO_IDS = {
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

/**
 * Map our currency codes → CoinCap IDs
 * (fallback API, uses lowercase symbol names)
 */
const COINCAP_IDS = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  USDT: 'tether',
  USDC: 'usd-coin',
  BNB: 'binance-coin',
  SOL: 'solana',
  XRP: 'xrp',
  ADA: 'cardano',
  DOGE: 'dogecoin',
  TRX: 'tron',
  MATIC: 'polygon',
  LTC: 'litecoin',
};

/**
 * Static fallback prices — used ONLY if both APIs are down.
 * These are rough estimates, not live prices. Never used when APIs work.
 * Update periodically or set to null to force an error instead.
 */
const FALLBACK_PRICES = {
  BTC: 67000,
  ETH: 3200,
  USDT: 1,
  USDC: 1,
  BNB: 600,
  SOL: 170,
  XRP: 0.62,
  ADA: 0.45,
  DOGE: 0.16,
  TRX: 0.13,
  MATIC: 0.89,
  LTC: 85,
};

// ─────────────────────────────────────────────────────────────
// IN-MEMORY CACHE
// ─────────────────────────────────────────────────────────────
const priceCache = new Map(); // currency → { price, source, fetchedAt }

const getCached = (currency) => {
  const entry = priceCache.get(currency);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    priceCache.delete(currency);
    return null;
  }
  return entry;
};

const setCache = (currency, price, source) => {
  priceCache.set(currency, {
    price,
    source,
    fetchedAt: Date.now(),
  });
};

// ─────────────────────────────────────────────────────────────
// PROVIDERS
// ─────────────────────────────────────────────────────────────

/**
 * Fetch price from CoinGecko (primary)
 * Free tier: ~10-30 calls/minute — more than enough with 60s cache
 */
const fetchFromCoinGecko = async (currency) => {
  const id = COINGECKO_IDS[currency];
  if (!id) throw new Error(`Unsupported currency: ${currency}`);

  const { data } = await axios.get(
    `${COINGECKO_BASE}/simple/price`,
    {
      params: {
        ids: id,
        vs_currencies: 'usd',
      },
      timeout: 10_000,
    }
  );

  const price = data?.[id]?.usd;
  if (typeof price !== 'number' || price <= 0) {
    throw new Error(`Invalid price from CoinGecko for ${currency}`);
  }

  return price;
};

/**
 * Fetch price from CoinCap (fallback)
 */
const fetchFromCoinCap = async (currency) => {
  const id = COINCAP_IDS[currency];
  if (!id) throw new Error(`Unsupported currency: ${currency}`);

  const { data } = await axios.get(
    `${COINCAP_BASE}/assets/${id}`,
    { timeout: 10_000 }
  );

  const price = parseFloat(data?.data?.priceUsd);
  if (isNaN(price) || price <= 0) {
    throw new Error(`Invalid price from CoinCap for ${currency}`);
  }

  return price;
};

// ─────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────

/**
 * Get the current USD price of a single currency.
 *
 * @param {string} currency — e.g. 'BTC', 'ETH'
 * @param {object} [opts]
 * @param {boolean} [opts.force=false] — bypass cache
 * @returns {Promise<{ usdPrice: number, currency: string, source: string }>}
 */
const getPrice = async (currency, opts = {}) => {
  const { force = false } = opts;

  if (!currency || typeof currency !== 'string') {
    throw new Error('Currency is required');
  }

  const currencyUpper = currency.toUpperCase().trim();

  // 1. Cache check
  if (!force) {
    const cached = getCached(currencyUpper);
    if (cached) {
      return {
        usdPrice: cached.price,
        currency: currencyUpper,
        source: cached.source,
      };
    }
  }

  // 2. Try CoinGecko
  try {
    const price = await fetchFromCoinGecko(currencyUpper);
    setCache(currencyUpper, price, 'coingecko');
    return {
      usdPrice: price,
      currency: currencyUpper,
      source: 'coingecko',
    };
  } catch (err) {
    console.warn(`CoinGecko failed for ${currencyUpper}:`, err.message);
  }

  // 3. Try CoinCap
  try {
    const price = await fetchFromCoinCap(currencyUpper);
    setCache(currencyUpper, price, 'coincap');
    return {
      usdPrice: price,
      currency: currencyUpper,
      source: 'coincap',
    };
  } catch (err) {
    console.warn(`CoinCap failed for ${currencyUpper}:`, err.message);
  }

  // 4. Fallback to static price
  const fallback = FALLBACK_PRICES[currencyUpper];
  if (typeof fallback === 'number' && fallback > 0) {
    console.warn(`Using fallback price for ${currencyUpper}: $${fallback}`);
    setCache(currencyUpper, fallback, 'fallback');
    return {
      usdPrice: fallback,
      currency: currencyUpper,
      source: 'fallback',
    };
  }

  // 5. Nothing worked
  throw new Error(
    `Unable to fetch price for ${currencyUpper} from any provider`
  );
};

/**
 * Convert a USD amount to the equivalent crypto amount.
 *
 * @param {number} amountUSD — e.g. 100
 * @param {string} currency — e.g. 'BTC'
 * @returns {Promise<{
 *   amountUSD: number,
 *   amountCrypto: number,
 *   price: number,
 *   source: string
 * }>}
 */
const usdToCrypto = async (amountUSD, currency) => {
  const amount = Number(amountUSD);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error('Invalid USD amount');
  }

  const priceData = await getPrice(currency);
  const price = priceData.usdPrice;

  // Round to 8 decimals (standard crypto precision)
  const amountCrypto = parseFloat((amount / price).toFixed(8));

  return {
    amountUSD: parseFloat(amount.toFixed(2)),
    amountCrypto,
    price,
    source: priceData.source,
  };
};

/**
 * Convert a crypto amount to the equivalent USD amount.
 *
 * @param {number} amountCrypto — e.g. 0.00148
 * @param {string} currency — e.g. 'BTC'
 * @returns {Promise<{
 *   amountCrypto: number,
 *   amountUSD: number,
 *   price: number,
 *   source: string
 * }>}
 */
const cryptoToUsd = async (amountCrypto, currency) => {
  const amount = Number(amountCrypto);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error('Invalid crypto amount');
  }

  const priceData = await getPrice(currency);
  const price = priceData.usdPrice;

  const amountUSD = parseFloat((amount * price).toFixed(2));

  return {
    amountCrypto: parseFloat(amount.toFixed(8)),
    amountUSD,
    price,
    source: priceData.source,
  };
};

/**
 * Fetch prices for multiple currencies in one call.
 * More efficient than calling getPrice() N times.
 *
 * @param {string[]} currencies — e.g. ['BTC', 'ETH', 'USDT']
 * @returns {Promise<Record<string, { usdPrice: number, source: string }>>}
 */
const getPrices = async (currencies = []) => {
  if (!Array.isArray(currencies) || currencies.length === 0) {
    return {};
  }

  const result = {};
  const toFetch = [];

  // Check cache first
  for (const c of currencies) {
    const upper = String(c).toUpperCase().trim();
    const cached = getCached(upper);
    if (cached) {
      result[upper] = { usdPrice: cached.price, source: cached.source };
    } else {
      toFetch.push(upper);
    }
  }

  if (toFetch.length === 0) return result;

  // Try CoinGecko batch
  try {
    const ids = toFetch
      .map((c) => COINGECKO_IDS[c])
      .filter(Boolean);

    if (ids.length > 0) {
      const { data } = await axios.get(
        `${COINGECKO_BASE}/simple/price`,
        {
          params: {
            ids: ids.join(','),
            vs_currencies: 'usd',
          },
          timeout: 10_000,
        }
      );

      for (const currency of toFetch) {
        const id = COINGECKO_IDS[currency];
        const price = data?.[id]?.usd;
        if (typeof price === 'number' && price > 0) {
          setCache(currency, price, 'coingecko');
          result[currency] = { usdPrice: price, source: 'coingecko' };
        }
      }
    }
  } catch (err) {
    console.warn('CoinGecko batch fetch failed:', err.message);
  }

  // Fallback for anything that didn't resolve
  for (const currency of toFetch) {
    if (result[currency]) continue;

    const fallback = FALLBACK_PRICES[currency];
    if (typeof fallback === 'number' && fallback > 0) {
      setCache(currency, fallback, 'fallback');
      result[currency] = { usdPrice: fallback, source: 'fallback' };
    }
  }

  return result;
};

/**
 * Clear the price cache (useful for admin "refresh prices" actions)
 */
const clearCache = () => {
  priceCache.clear();
};

module.exports = {
  getPrice,
  usdToCrypto,
  cryptoToUsd,
  getPrices,
  clearCache,
};