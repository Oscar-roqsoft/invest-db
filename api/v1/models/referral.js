

// app/v1/models/referral.js
const mongoose = require('mongoose');

const ReferralSchema = new mongoose.Schema({
  referrer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  referred: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  // Source of commission (which deposit earned this referral)
  deposit: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Deposit',
  },
  // Commission amounts
  amount: {
    type: Number,
    required: true, // Commission earned by referrer
    min: 0,
  },
  sourceAmount: {
    type: Number,
    required: true, // The deposit amount that generated this
    min: 0,
  },
  rate: {
    type: Number,
    default: 0.05, // 5%
  },
  currency: {
    type: String,
    default: 'USD',
  },
  // Referral level (in case you want multi-tier later)
  level: {
    type: Number,
    default: 1,
    min: 1,
    max: 3,
  },
  status: {
    type: String,
    enum: ['pending', 'credited', 'failed'],
    default: 'credited',
    index: true,
  },
  // Snapshot of referred user info at the time
  referredSnapshot: {
    name: String,
    email: String,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
});

// Prevent duplicate commission for same deposit
ReferralSchema.index({ referrer: 1, deposit: 1 }, { unique: true, sparse: true });

// Indexes for queries
ReferralSchema.index({ referrer: 1, createdAt: -1 });
// ReferralSchema.index({ referred: 1 });

module.exports = mongoose.model('Referral', ReferralSchema);