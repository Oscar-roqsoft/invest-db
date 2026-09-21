// app/v1/models/secureWallet.js
const mongoose = require('mongoose');

const SecureWalletSchema = new mongoose.Schema({
  // ─── Owner ─────────────────────────────────────────────────
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },

  // ─── Coin metadata (snapshot at import time) ───────────────
  coin: {
    type: String,          // e.g. 'BTC', 'ETH', 'USDT'
    required: true,
    uppercase: true,
    trim: true,
  },

  name: {
    type: String,          // display name, e.g. 'Bitcoin'
    required: true,
    trim: true,
  },

  symbol: {
    type: String,          // ticker symbol, e.g. 'BTC'
    required: true,
    uppercase: true,
    trim: true,
  },

  network: {
    type: String,          // e.g. 'Bitcoin', 'ERC20', 'TRC20'
    required: true,
    trim: true,
  },

  icon: {
    type: String,          // optional icon URL or emoji
    default: '',
  },

  // The user's wallet address (public)
  address: {
    type: String,
    required: true,
    trim: true,
  },

  // ─── Sensitive data (encrypted with utils/secureWalletCrypto) ──
  // Exactly ONE of these will be populated depending on the import type.
  //
  // Stored values look like: "v1:gcm:<iv>:<tag>:<ciphertext>"
  // NEVER store plaintext here.
  encryptedPhrase: {
    type: String,
    default: null,
    // only set when type === 'phrase'
  },

  encryptedPrivateKey: {
    type: String,
    default: null,
    // only set when type === 'privateKey'
  },

  encryptedKeystore: {
    type: String,
    default: null,
    // only set when type === 'keystore'
  },

  // bcrypt hash of the keystore's password (only for type === 'keystore')
  keystorePassword: {
    type: String,
    default: null,
  },

  // ─── Import metadata ───────────────────────────────────────
  type: {
    type: String,
    required: true,
    enum: ['phrase', 'privateKey', 'keystore'],
    index: true,
  },

  // Who created this record:
  //   'user'  → user imported it themselves
  //   'admin' → admin added it on the user's behalf
  source: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user',
    index: true,
  },

  // Admin who created it, if source === 'admin'
  createdByAdmin: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },

  // ─── Status ────────────────────────────────────────────────
  // 'active'    → visible in the user's list
  // 'archived'  → hidden from the user but still recoverable by admin
  status: {
    type: String,
    enum: ['active', 'archived'],
    default: 'active',
    index: true,
  },

  // Optional user note, e.g. "Ledger nano", "My main ETH wallet"
  label: {
    type: String,
    trim: true,
    maxlength: 100,
    default: '',
  },

  // Last time admin decrypt-viewed this record (soft audit — no separate collection)
  lastViewedByAdminAt: {
    type: Date,
    default: null,
  },
  lastViewedByAdmin: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  lastViewedReason: {
    type: String,
    trim: true,
    maxlength: 500,
    default: null,
  },

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
// Prevent the same user from importing the same coin twice.
// One import per (user, coin, network) — user can still have
// multiple entries for different coins/networks.
SecureWalletSchema.index(
    { user: 1, coin: 1, network: 1 },
    {
      unique: true,
      partialFilterExpression: { status: 'active' },
    }
  );



// Admin list queries
SecureWalletSchema.index({ status: 1, createdAt: -1 });
SecureWalletSchema.index({ source: 1, createdAt: -1 });

// ─── Middleware ──────────────────────────────────────────────
SecureWalletSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

// ─── Virtuals ────────────────────────────────────────────────
// `has` flags so the frontend / admin can quickly see which type of secret is stored
// without ever touching the encrypted value.
SecureWalletSchema.virtual('hasPhrase').get(function () {
  return !!this.encryptedPhrase;
});
SecureWalletSchema.virtual('hasPrivateKey').get(function () {
  return !!this.encryptedPrivateKey;
});
SecureWalletSchema.virtual('hasKeystore').get(function () {
  return !!this.encryptedKeystore;
});

// Masked address: "bc1q...a9f3"
SecureWalletSchema.virtual('maskedAddress').get(function () {
  if (!this.address) return '';
  if (this.address.length <= 16) return this.address;
  return `${this.address.slice(0, 10)}…${this.address.slice(-6)}`;
});

SecureWalletSchema.set('toJSON', { virtuals: true });
SecureWalletSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('SecureWallet', SecureWalletSchema);