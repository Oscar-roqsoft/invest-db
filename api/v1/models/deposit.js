// app/v1/models/deposit.js
const mongoose = require('mongoose');

const DepositSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  reference: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  currency: {
    type: String,
    required: true,
    enum: ['BTC', 'ETH', 'USDT', 'USDC', 'BNB', 'SOL', 'XRP', 'ADA', 'DOGE', 'TRX', 'MATIC', 'LTC'],
    index: true,
  },
  network: {
    type: String,
    required: true,
  },
  amountUSD: {
    type: Number,
    required: true,
    min: 0,
  },
  amountCrypto: {
    type: Number,
    required: true,
    min: 0,
  },
  address: {
    type: String,
    required: true,
    trim: true,
  },
  txHash: {
    type: String,
    default: '',
    trim: true,
  },
  confirmations: {
    type: Number,
    default: 0,
  },
  requiredConfirmations: {
    type: Number,
    default: 2,
  },
  status: {
    type: String,
    enum: ['pending', 'confirming', 'completed', 'failed', 'expired'],
    default: 'pending',
    index: true,
  },
  note: {
    type: String,
    default: '',
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  creditedAt: Date,
  confirmedAt: Date,
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 30 * 60 * 1000), // 30 min
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
});

// Auto-expire pending deposits
DepositSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('Deposit', DepositSchema);