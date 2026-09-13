// app/v1/models/transaction.js
const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  type: {
    type: String,
    enum: ['deposit', 'withdrawal', 'investment', 'earning', 'referral', 'refund', 'bonus'],
    required: true,
    index: true,
  },
  direction: {
    type: String,
    enum: ['credit', 'debit'],
    required: true,
    index: true,
  },
  currency: {
    type: String,
    enum: ['BTC', 'ETH', 'USDT', 'USDC', 'BNB', 'SOL', 'XRP', 'ADA', 'DOGE', 'TRX', 'MATIC', 'LTC', 'USD'],
    required: true,
    index: true,
  },
  amount: {
    type: Number,
    required: true, // USD value
  },
  amountCrypto: {
    type: Number,
    default: 0, // crypto amount (0 for pure USD transactions)
  },
  balanceAfter: {
    type: Number,
    default: 0, // user's USD balance after this transaction
  },
  status: {
    type: String,
    enum: ['pending', 'confirming', 'completed', 'failed', 'cancelled'],
    default: 'pending',
    index: true,
  },
  reference: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  relatedId: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: 'relatedModel',
    index: true,
  },
  relatedModel: {
    type: String,
    enum: ['Deposit', 'Withdrawal', 'Investment', 'Referral'],
  },
  description: {
    type: String,
    default: '',
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
  completedAt: Date,
});

// Compound indexes for common queries
TransactionSchema.index({ user: 1, createdAt: -1 });
TransactionSchema.index({ user: 1, type: 1, createdAt: -1 });
TransactionSchema.index({ user: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('Transaction', TransactionSchema);