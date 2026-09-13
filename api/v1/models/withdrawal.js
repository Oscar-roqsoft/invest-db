// app/v1/models/withdrawal.js
const mongoose = require('mongoose');

const WithdrawalSchema = new mongoose.Schema({
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
  networkFeeUSD: {
    type: Number,
    default: 0,
  },
  networkFeeCrypto: {
    type: Number,
    default: 0,
  },
  processingFeeUSD: {
    type: Number,
    default: 0,
  },
  totalFeeUSD: {
    type: Number,
    default: 0,
  },
  netAmountUSD: {
    type: Number,
    required: true,
    min: 0,
  },
  netAmountCrypto: {
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
  status: {
    type: String,
    enum: ['pending', 'approved', 'processing', 'completed', 'rejected', 'cancelled'],
    default: 'pending',
    index: true,
  },
  adminNote: {
    type: String,
    default: '',
  },
  rejectionReason: {
    type: String,
    default: '',
  },
  processedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  approvedAt: Date,
  processedAt: Date,
  completedAt: Date,
  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
});

module.exports = mongoose.model('Withdrawal', WithdrawalSchema);