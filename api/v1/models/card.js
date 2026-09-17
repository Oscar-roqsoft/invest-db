// app/v1/models/card.js
const mongoose = require('mongoose');

const CardSchema = new mongoose.Schema({
  // ─── Owner ─────────────────────────────────────────────────
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },

  // ─── Card identity ─────────────────────────────────────────
  // Full 16-digit PAN. Stored as-is (no encryption, per spec).
  fullNumber: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    // 16 digits — Luhn-valid
    match: [/^\d{16}$/, 'Card number must be exactly 16 digits'],
  },

  // Masked display value: "•••• •••• •••• 1234"
  cardNumber: {
    type: String,
    required: true,
    trim: true,
  },

  // Convenience: last 4 digits for quick lookups / display
  last4: {
    type: String,
    required: true,
    trim: true,
    match: [/^\d{4}$/, 'last4 must be 4 digits'],
  },

  // 3-digit CVV. Stored as-is (no encryption, per spec).
  cvv: {
    type: String,
    required: true,
    trim: true,
    match: [/^\d{3}$/, 'CVV must be 3 digits'],
  },

  // Expiry — month 1-12, 4-digit year
  expiryMonth: {
    type: Number,
    required: true,
    min: 1,
    max: 12,
  },
  expiryYear: {
    type: Number,
    required: true,
    min: 2024,
  },

  // Cardholder name as it appears on the card (uppercase)
  cardholderName: {
    type: String,
    required: true,
    trim: true,
    uppercase: true,
    maxlength: 26,
  },

  // ─── Tier ──────────────────────────────────────────────────
  tier: {
    type: String,
    required: true,
    enum: ['gold', 'black'],
    lowercase: true,
    index: true,
  },

  // ─── Status ────────────────────────────────────────────────
  status: {
    type: String,
    required: true,
    enum: ['active', 'frozen', 'expired', 'cancelled'],
    default: 'active',
    index: true,
  },

  // ─── Currency (display only — cards have no balance) ───────
  currency: {
    type: String,
    default: 'USD',
    enum: ['USD'],
  },

  // ─── Audit ─────────────────────────────────────────────────
  // Whoever created the card: the user themselves OR an admin
  generatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },

  // True if an admin generated it on the user's behalf
  createdByAdmin: {
    type: Boolean,
    default: false,
  },

  // ─── Lifecycle timestamps ──────────────────────────────────
  issuedAt: {
    type: Date,
    default: Date.now,
    index: true,
  },

  // Full card expiry (3 years from issue)
  expiresAt: {
    type: Date,
    required: true,
  },

  // Timestamps for freeze/unfreeze/delete
  frozenAt: Date,
  cancelledAt: Date,

  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// ─── Indexes ─────────────────────────────────────────────────
// One card per (user, tier) — a user can have at most 1 Gold + 1 Black
CardSchema.index({ user: 1, tier: 1 }, { unique: true });

// Fast admin queries
// CardSchema.index({ status: 1, createdAt: -1 });
// CardSchema.index({ tier: 1, status: 1 });
// CardSchema.index({ createdAt: -1 });

// ─── Middleware ──────────────────────────────────────────────
CardSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  // Ensure last4 is in sync if fullNumber is set/changed
  if (this.isModified('fullNumber') && this.fullNumber) {
    this.last4 = this.fullNumber.slice(-4);
  }
  // Ensure masked cardNumber matches fullNumber
  if (this.isModified('fullNumber') && this.fullNumber) {
    this.cardNumber = `•••• •••• •••• ${this.fullNumber.slice(-4)}`;
  }
  next();
});

// ─── Virtuals ────────────────────────────────────────────────
CardSchema.virtual('isExpired').get(function () {
  return this.expiresAt && this.expiresAt.getTime() < Date.now();
});

CardSchema.virtual('expiryDisplay').get(function () {
  const m = String(this.expiryMonth).padStart(2, '0');
  return `${m}/${String(this.expiryYear).slice(-2)}`;
});

// Include virtuals in JSON / toObject
CardSchema.set('toJSON', { virtuals: true });
CardSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Card', CardSchema);