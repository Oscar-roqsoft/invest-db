// app/v1/models/systemWallet.js
const mongoose = require('mongoose');

const SystemWalletSchema = new mongoose.Schema({
  currency: {
    type: String,
    required: true,
    enum: ['BTC', 'ETH', 'USDT', 'USDC', 'BNB', 'SOL', 'XRP', 'ADA', 'DOGE', 'TRX', 'MATIC', 'LTC'],
  },
  name: {
    type: String,
    required: true,
  },
  network: {
    type: String,
    required: true,
  },
  address: {
    type: String,
    required: true,
    trim: true,
  },
  emoji: {
    type: String,
    default: '₿',
  },
  color: {
    type: String,
    default: '#F7931A',
  },
  minDeposit: {
    type: Number,
    default: 20,
  },
  requiredConfirmations: {
    type: Number,
    default: 2,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  sortOrder: {
    type: Number,
    default: 0,
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// One address per currency+network
SystemWalletSchema.index({ currency: 1, network: 1 }, { unique: true });

SystemWalletSchema.pre('save', function () {
  this.updatedAt = new Date();
});

module.exports = mongoose.model('SystemWallet', SystemWalletSchema);