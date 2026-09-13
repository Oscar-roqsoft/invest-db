// app/v1/models/investment.js
const mongoose = require('mongoose');

const InvestmentSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  plan: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'InvestmentPlan',
    required: true,
    index: true,
  },
  // Snapshot of plan data (so changing plan later doesn't affect existing investments)
  planName: { type: String, required: true },
  planSlug: { type: String, required: true },

  amount: {
    type: Number,
    required: true,
    min: 0, // USD invested
  },
  dailyRoi: {
    type: Number,
    required: true, // e.g. 1.5
  },
  duration: {
    type: Number,
    required: true, // days
  },
  totalRoi: {
    type: Number,
    required: true, // e.g. 60 for Growth (1.5 * 40)
  },
  expectedProfit: {
    type: Number,
    required: true, // amount * (totalRoi/100)
  },
  expectedReturn: {
    type: Number,
    required: true, // amount + expectedProfit
  },
  dailyEarning: {
    type: Number,
    required: true, // amount * (dailyRoi/100)
  },

  earned: {
    type: Number,
    default: 0, // Accumulated earnings
  },
  daysCompleted: {
    type: Number,
    default: 0,
  },
  lastPayoutAt: Date,
  nextPayoutAt: Date,

  startDate: {
    type: Date,
    default: Date.now,
    index: true,
  },
  endDate: {
    type: Date,
    required: true,
    index: true,
  },
  completedAt: Date,

  status: {
    type: String,
    enum: ['active', 'completed', 'cancelled'],
    default: 'active',
    index: true,
  },
  principalReturned: {
    type: Boolean,
    default: false,
  },
  earningsPaid: {
    type: Boolean,
    default: false,
  },

  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('Investment', InvestmentSchema);