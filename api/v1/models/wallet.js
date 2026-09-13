// app/v1/models/wallet.js
const mongoose = require('mongoose');

const WalletSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  currency: {
    type: String,
    required: true,
    enum: ['BTC', 'ETH', 'USDT', 'USDC', 'BNB', 'SOL', 'XRP', 'ADA', 'DOGE', 'TRX', 'MATIC', 'LTC'],
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
  label: {
    type: String,
    trim: true,
    default: '',
  },
  isPrimary: {
    type: Boolean,
    default: false,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

WalletSchema.index({ user: 1, currency: 1, address: 1 }, { unique: true });

module.exports = mongoose.model('Wallet', WalletSchema);