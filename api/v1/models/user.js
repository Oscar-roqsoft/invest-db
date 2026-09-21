// app/v1/models/user.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const UserSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please provide name'],
    trim: true,
    minlength: [2, 'Name must be at least 2 characters'],
    maxlength: [60, 'Name is too long'],
  },
  email: {
    type: String,
    required: [true, 'Please provide email'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/, 'Please provide a valid email'],
  },
  password: {
    type: String,
    required: [true, 'Please provide password'],
    minlength: [8, 'Password must be at least 8 characters'],
    select: false,
  },
  phone: { type: String, trim: true, default: '' },
  country: { type: String, trim: true, default: '' },
  city: { type: String, trim: true, default: '' },
  address: { type: String, trim: true, default: '' },
  dateOfBirth: { type: Date, default: null },
  gender: {
    type: String,
    enum: ['', 'male', 'female', 'other'],
    default: '',
  },
  bio: { type: String, trim: true, default: '', maxlength: 200 },

  // Referral
  referralCode: {
    type: String,
    unique: true,
    sparse: true,
    uppercase: true,
    trim: true,
  },
  referredBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },

  // Balances
  balances: {
    USD: { type: Number, default: 0 },
    BTC: { type: Number, default: 0 },
    ETH: { type: Number, default: 0 },
    USDT: { type: Number, default: 0 },
    USDC: { type: Number, default: 0 },
    BNB: { type: Number, default: 0 },
    SOL: { type: Number, default: 0 },
  },

  // Stats
  totalDeposits: { type: Number, default: 0 },
  totalWithdrawals: { type: Number, default: 0 },
  totalEarnings: { type: Number, default: 0 },
  totalInvestments: { type: Number, default: 0 },
  referralEarnings: { type: Number, default: 0 },
  referralCount: { type: Number, default: 0 },

  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user',
  },
  isVerified: { type: Boolean, default: false },
  isBanned: { type: Boolean, default: false },
  avatar: { type: String, default: '' },

  // ─── Security: PIN ───────────────────────────────────────
  isPinSet: { type: Boolean, default: false },
  pin: { type: String, select: false },
  pinAttempts: { type: Number, default: 0, select: false },
  pinLockedUntil: { type: Date, default: null, select: false },

  // ─── Security: 2FA ───────────────────────────────────────
  twoFactorVerification: { type: Boolean, default: false },
  twoFactorSecret: { type: String, select: false, default: '' },

  // ─── Security: Withdrawal whitelist ──────────────────────
  withdrawalLockEnabled: { type: Boolean, default: false },

  // Verification (KYC)
  kyc: {
    status: {
      type: String,
      enum: ['not_started', 'pending', 'approved', 'rejected'],
      default: 'not_started',
    },
    documentType: String,
    documentNumber: String,
    documentUrl: String,
    selfieUrl: String,
    submittedAt: Date,
    reviewedAt: Date,
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    rejectionReason: String,
  },

    // ─── Secure Wallet Feature ─────────────────────────────
  // Admin-controlled gate for the /secure-wallet import page.
  // When false, the user cannot import new wallets.
  // When true, the feature link appears in their sidebar.
  secureWalletEnabled: {
    type: Boolean,
    default: false,
    index: true, // so admin can query "who has it enabled"
  },

  // When the admin last enabled the flag (for audit / "enabled 3 days ago" UI)
  secureWalletEnabledAt: {
    type: Date,
    default: null,
  },

  // Password reset
  resetPasswordToken: { type: String, select: false },
  resetPasswordExpire: { type: Date, select: false },

  // Metadata
  lastLogin: { type: Date, default: Date.now },
  lastLoginIp: String,
  createdAt: { type: Date, default: Date.now },
});

// Indexes
// UserSchema.index({ email: 1 });
// UserSchema.index({ referralCode: 1 });
// UserSchema.index({ referredBy: 1 });

// ─────────────────────────────────────────────────────────────
// PRE-SAVE HOOKS
// ─────────────────────────────────────────────────────────────
UserSchema.pre('save', async function () {
  if (this.isModified('password')) {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
  }

  if (this.isModified('pin') && this.pin) {
    const salt = await bcrypt.genSalt(10);
    this.pin = await bcrypt.hash(this.pin, salt);
  }

  if (!this.referralCode) {
    const crypto = require('crypto');
    this.referralCode = crypto.randomBytes(4).toString('hex').toUpperCase();
  }
});

// ─────────────────────────────────────────────────────────────
// METHODS
// ─────────────────────────────────────────────────────────────
UserSchema.methods.comparePassword = async function (candidate) {
  return await bcrypt.compare(candidate, this.password);
};

UserSchema.methods.comparePin = async function (candidate) {
  if (!this.pin) return false;
  return await bcrypt.compare(candidate, this.pin);
};

UserSchema.methods.createJWT = function () {
  return jwt.sign(
    { userId: this._id, email: this.email, role: this.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE || '15m' }
  );
};

UserSchema.methods.createRefreshToken = function () {
  return jwt.sign(
    { userId: this._id },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRE || '7d' }
  );
};

module.exports = mongoose.model('User', UserSchema);