// config/withdrawalFees.js

// Network fees in USD (approximate)
const NETWORK_FEES = {
    BTC: 13.48,
    ETH: 16.23,
    USDT: 1.00,
    USDC: 3.00,
    BNB: 0.60,
    SOL: 0.01,
    XRP: 0.001,
    ADA: 0.08,
    DOGE: 0.16,
    TRX: 0.13,
    MATIC: 0.01,
    LTC: 0.09,
  };
  
  // Platform processing fee (percentage)
  const PROCESSING_FEE_RATE = 0.01; // 1%
  
  // Minimums
  const MIN_WITHDRAWAL_USD = 20;
  const MIN_NET_AMOUNT_USD = 1; // Net after fees must be at least $1
  
  // Get network fee for a currency
  const getNetworkFeeUSD = (currency) => {
    return NETWORK_FEES[currency.toUpperCase()] || 0;
  };
  
  // Calculate total fees
  const calculateFees = (amountUSD, currency) => {
    const networkFeeUSD = getNetworkFeeUSD(currency);
    const processingFeeUSD = amountUSD * PROCESSING_FEE_RATE;
    const totalFeeUSD = networkFeeUSD + processingFeeUSD;
    const netAmountUSD = amountUSD - totalFeeUSD;
  
    return {
      networkFeeUSD: parseFloat(networkFeeUSD.toFixed(2)),
      processingFeeUSD: parseFloat(processingFeeUSD.toFixed(2)),
      totalFeeUSD: parseFloat(totalFeeUSD.toFixed(2)),
      netAmountUSD: parseFloat(netAmountUSD.toFixed(2)),
    };
  };
  
  module.exports = {
    NETWORK_FEES,
    PROCESSING_FEE_RATE,
    MIN_WITHDRAWAL_USD,
    MIN_NET_AMOUNT_USD,
    getNetworkFeeUSD,
    calculateFees,
  };