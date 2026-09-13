// app/v1/models/investmentPlan.js
const mongoose = require('mongoose');

const InvestmentPlanSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  slug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  description: {
    type: String,
    default: '',
  },
  dailyRoi: {
    type: Number,
    required: true,
    min: 0, // e.g. 1.5 = 1.5% per day
  },
  duration: {
    type: Number,
    required: true,
    min: 1, // days
  },
  minAmount: {
    type: Number,
    required: true,
    min: 0,
  },
  maxAmount: {
    type: Number,
    required: true,
    min: 0,
  },
  features: {
    type: [String],
    default: [],
  },
  icon: {
    type: String,
    default: 'bi bi-graph-up-arrow',
  },
  color: {
    type: String,
    default: '#bb914a',
  },
  isPopular: {
    type: Boolean,
    default: false,
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true,
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

// Compound unique: slug
// InvestmentPlanSchema.index({ slug: 1 }, { unique: true });

// Total ROI virtual
InvestmentPlanSchema.virtual('totalRoi').get(function () {
  return parseFloat((this.dailyRoi * this.duration).toFixed(2));
});

// Effective max amount virtual
InvestmentPlanSchema.virtual('expectedReturnPerThousand').get(function () {
  const profit = 1000 * (this.dailyRoi / 100) * this.duration;
  return parseFloat((1000 + profit).toFixed(2));
});

InvestmentPlanSchema.set('toJSON', { virtuals: true });
InvestmentPlanSchema.set('toObject', { virtuals: true });

InvestmentPlanSchema.pre('save', function () {
  this.updatedAt = new Date();
});

module.exports = mongoose.model('InvestmentPlan', InvestmentPlanSchema);