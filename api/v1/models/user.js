// models/user.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const UserSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please provide name'],
    trim: true,
    minlength: [2, 'Name must be at least 2 characters']
  },
  email: {
    type: String,
    required: [true, 'Please provide email'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/, 'Please provide a valid email']
  },
  password: {
    type: String,
    required: [true, 'Please provide password'],
    minlength: [8, 'Password must be at least 8 characters'],
    select: false
  },
  phone: { type: String, trim: true },
  country: { type: String, trim: true },

  // Referral
  referralCode: {
    type: String,
    unique: true,
    sparse: true,
    uppercase: true,
    trim: true
  },
  referredBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },

  // Balances (in USD value + crypto amounts)
  balances: {
    USD: { type: Number, default: 0 },      // Main fiat-equivalent balance
    BTC: { type: Number, default: 0 },      // Crypto balances
    ETH: { type: Number, default: 0 },
    USDT: { type: Number, default: 0 },
    USDC: { type: Number, default: 0 },
    BNB: { type: Number, default: 0 },
    SOL: { type: Number, default: 0 }
  },

  // Earnings & Stats
  totalDeposits: { type: Number, default: 0 },
  totalWithdrawals: { type: Number, default: 0 },
  totalEarnings: { type: Number, default: 0 },
  totalInvestments: { type: Number, default: 0 },
  referralEarnings: { type: Number, default: 0 },

  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  isVerified: { type: Boolean, default: false },
  isPinSet: { type: Boolean, default: false },
  isBanned: { type: Boolean, default: false },
  pin: { type: String, select: false },
  avatar: { type: String, default: '' },
  twoFactorVerification: { type: Boolean, default: false },
  userIdentity: { type: String, default: '' },

  // Verification (KYC)
  kyc: {
    status: {
      type: String,
      enum: ['not_started', 'pending', 'approved', 'rejected'],
      default: 'not_started'
    },
    documentType: String,
    documentUrl: String,
    submittedAt: Date,
    reviewedAt: Date,
    rejectionReason: String
  },

  // Password reset
  resetPasswordToken: { type: String, select: false },
  resetPasswordExpire: { type: Date, select: false },

  // Metadata
  lastLogin: { type: Date, default: Date.now },
  lastLoginIp: String,
  createdAt: { type: Date, default: Date.now }
});

// ─────────────────────────────────────────────────────────────
// INDEXES
// ─────────────────────────────────────────────────────────────
// UserSchema.index({ email: 1 });
// UserSchema.index({ referralCode: 1 });

// ─────────────────────────────────────────────────────────────
// PRE-SAVE HOOKS
// ─────────────────────────────────────────────────────────────
UserSchema.pre('save', async function () {
  // Hash password
  if (this.isModified('password')) {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
  }

  // Generate referral code
  if (!this.referralCode) {
    const crypto = require('crypto');
    this.referralCode = crypto.randomBytes(4).toString('hex').toUpperCase();
  }
});

// ─────────────────────────────────────────────────────────────
// METHODS
// ─────────────────────────────────────────────────────────────
UserSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

UserSchema.methods.createJWT = function () {
  return jwt.sign(
    {
      userId: this._id,
      email: this.email,
      role: this.role
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE || '15m' }
  );
};

UserSchema.methods.createRefreshToken = function () {
  return jwt.sign(
    { userId: this._id },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRE || '3d' }
  );
};

module.exports = mongoose.model('User', UserSchema);