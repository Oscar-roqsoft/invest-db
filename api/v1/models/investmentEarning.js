// app/v1/models/investmentEarning.js
const mongoose = require('mongoose');

const InvestmentEarningSchema = new mongoose.Schema({
  investment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Investment',
    required: true,
    index: true,
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
  day: {
    type: Number,
    required: true, // day 1, 2, 3, ... of investment
  },
  paidAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
});

InvestmentEarningSchema.index({ investment: 1, day: 1 }, { unique: true });

module.exports = mongoose.model('InvestmentEarning', InvestmentEarningSchema);