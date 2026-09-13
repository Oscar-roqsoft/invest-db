// app/v1/models/cryptoPrice.js
const mongoose = require('mongoose');

const CryptoPriceSchema = new mongoose.Schema({
  symbol: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    index: true,
  },
  name: {
    type: String,
    required: true,
  },
  usdPrice: {
    type: Number,
    required: true,
    min: 0,
  },
  change24h: {
    type: Number,
    default: 0, // percentage
  },
  marketCap: {
    type: Number,
    default: 0,
  },
  volume24h: {
    type: Number,
    default: 0,
  },
  // Admin override (if set, this price is used instead of API)
  overridePrice: {
    type: Number,
    default: null,
  },
  isManualOverride: {
    type: Boolean,
    default: false,
  },
  source: {
    type: String,
    enum: ['coingecko', 'manual', 'fallback'],
    default: 'fallback',
  },
  lastUpdated: {
    type: Date,
    default: Date.now,
  },
});

// Get effective price (override if set, otherwise usdPrice)
CryptoPriceSchema.virtual('effectivePrice').get(function () {
  return this.isManualOverride && this.overridePrice !== null
    ? this.overridePrice
    : this.usdPrice;
});

CryptoPriceSchema.set('toJSON', { virtuals: true });
CryptoPriceSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('CryptoPrice', CryptoPriceSchema);