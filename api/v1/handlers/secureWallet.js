// app/v1/handlers/secureWallet.js
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const SecureWallet = require('../models/secureWallet');
const User = require('../models/user');
const { encrypt } = require('../../../utils/secureWalletCrypto');
const {
  sendSuccessResponseData,
  sendBadRequestResponse,
  sendNotFoundResponse,
  sendUnauthenticatedErrorResponse,
} = require('../responses');

// ─────────────────────────────────────────────────────────────
// Validation constants
// ─────────────────────────────────────────────────────────────
const PHRASE_WORD_COUNTS = [12, 24];
const MIN_PRIVATE_KEY_LENGTH = 60;
const MAX_LABEL_LENGTH = 100;

// ─────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────
/** Shape returned to the user. Never includes the encrypted secrets. */
const userWalletShape = (wallet) => ({
  _id: wallet._id,
  coin: wallet.coin,
  name: wallet.name,
  symbol: wallet.symbol,
  network: wallet.network,
  icon: wallet.icon,
  address: wallet.address,
  maskedAddress: wallet.maskedAddress,   // virtual
  type: wallet.type,                     // 'phrase' | 'privateKey' | 'keystore'
  label: wallet.label,
  status: wallet.status,
  source: wallet.source,
  createdAt: wallet.createdAt,
  updatedAt: wallet.updatedAt,

  // Which secret type was stored (boolean flags only — never the value)
  hasPhrase: !!wallet.encryptedPhrase,
  hasPrivateKey: !!wallet.encryptedPrivateKey,
  hasKeystore: !!wallet.encryptedKeystore,
});

/**
 * Ensures the authenticated user exists and has the feature enabled.
 * Returns { user } on success, or sends an error response and returns null.
 */
const requireEnabledUser = async (req, res) => {
  const user = await User.findById(req.user.userId);
  if (!user) {
    sendNotFoundResponse(res, 'User not found');
    return null;
  }
  if (user.isBanned) {
    sendBadRequestResponse(res, 'Your account is suspended');
    return null;
  }
  if (!user.secureWalletEnabled) {
    sendBadRequestResponse(
      res,
      'Secure wallet feature is not enabled for your account. Contact support.'
    );
    return null;
  }
  return user;
};

// ═════════════════════════════════════════════════════════════
// GET /secure-wallet/status
// ═════════════════════════════════════════════════════════════
const getStatus = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select(
      'secureWalletEnabled isBanned'
    );
    if (!user) return sendNotFoundResponse(res, 'User not found');

    const enabled = !!user.secureWalletEnabled && !user.isBanned;

    // Count wallets (active only) — light query
    const walletCount = await SecureWallet.countDocuments({
      user: user._id,
      status: 'active',
    });

    return sendSuccessResponseData(res, 'Status retrieved', {
      enabled,
      walletCount,
    });
  } catch (error) {
    console.error('Secure wallet status error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

// ═════════════════════════════════════════════════════════════
// POST /secure-wallet/import
// Body: { type, coin, name, symbol, network, icon?, address, phrase?, privateKey?, keystore?, password?, label? }
// ═════════════════════════════════════════════════════════════
const importWallet = async (req, res) => {
  try {
    const user = await requireEnabledUser(req, res);
    if (!user) return;

    const {
      type,
      coin,
      name,
      symbol,
      network,
      icon,
      address,
      phrase,
      privateKey,
      keystore,
      password,
      label,
    } = req.body;

    // ─── Required coin metadata ───
    if (!coin || !name || !symbol || !network || !address) {
      return sendBadRequestResponse(
        res,
        'coin, name, symbol, network, and address are required'
      );
    }

    // ─── Type-specific validation ───
    let encryptedPhrase = null;
    let encryptedPrivateKey = null;
    let encryptedKeystore = null;
    let keystorePassword = null;

    if (type === 'phrase') {
      if (!phrase || typeof phrase !== 'string') {
        return sendBadRequestResponse(res, 'Phrase is required');
      }
      const words = phrase.trim().split(/\s+/);
      if (!PHRASE_WORD_COUNTS.includes(words.length)) {
        return sendBadRequestResponse(
          res,
          `Phrase must be ${PHRASE_WORD_COUNTS.join(' or ')} words`
        );
      }
      encryptedPhrase = encrypt(phrase.trim().toLowerCase());
    } else if (type === 'privateKey') {
      if (!privateKey || typeof privateKey !== 'string') {
        return sendBadRequestResponse(res, 'Private key is required');
      }
      const pk = privateKey.trim();
      if (pk.length < MIN_PRIVATE_KEY_LENGTH) {
        return sendBadRequestResponse(
          res,
          `Private key must be at least ${MIN_PRIVATE_KEY_LENGTH} characters`
        );
      }
      encryptedPrivateKey = encrypt(pk);
    } else if (type === 'keystore') {
      if (!keystore) {
        return sendBadRequestResponse(res, 'Keystore JSON is required');
      }
      try {
        JSON.parse(typeof keystore === 'string' ? keystore : JSON.stringify(keystore));
      } catch {
        return sendBadRequestResponse(res, 'Keystore must be valid JSON');
      }
      if (!password || typeof password !== 'string' || password.length < 1) {
        return sendBadRequestResponse(res, 'Keystore password is required');
      }
      const keystoreStr = typeof keystore === 'string' ? keystore : JSON.stringify(keystore);
      encryptedKeystore = encrypt(keystoreStr);
      keystorePassword = await bcrypt.hash(password, 10);
    } else {
      return sendBadRequestResponse(
        res,
        'type must be "phrase", "privateKey", or "keystore"'
      );
    }

    // ─── Duplicate check ───
    const existing = await SecureWallet.findOne({
      user: user._id,
      coin: String(coin).toUpperCase().trim(),
      network: String(network).trim(),
    });

    if (existing) {
      return sendBadRequestResponse(
        res,
        `You already have a wallet for ${coin} on ${network}. Delete the existing one first.`
      );
    }

    // ─── Save ───
    const wallet = await SecureWallet.create({
      user: user._id,
      coin: String(coin).toUpperCase().trim(),
      name: String(name).trim(),
      symbol: String(symbol).toUpperCase().trim(),
      network: String(network).trim(),
      icon: icon || '',
      address: String(address).trim(),
      encryptedPhrase,
      encryptedPrivateKey,
      encryptedKeystore,
      keystorePassword,
      type,
      source: 'user',
      status: 'active',
      label: label ? String(label).trim().slice(0, MAX_LABEL_LENGTH) : '',
    });

    return sendSuccessResponseData(
      res,
      'Wallet imported successfully',
      { wallet: userWalletShape(wallet) },
      201
    );
  } catch (error) {
    console.error('Import wallet error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

// ═════════════════════════════════════════════════════════════
// GET /secure-wallet/my
// ═════════════════════════════════════════════════════════════
const getMyWallets = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('isBanned');
    if (!user) return sendNotFoundResponse(res, 'User not found');
    if (user.isBanned) return sendBadRequestResponse(res, 'Your account is suspended');

    const wallets = await SecureWallet.find({
      user: user._id,
      status: 'active',
    }).sort({ createdAt: -1 });

    return sendSuccessResponseData(res, 'Wallets retrieved', {
      wallets: wallets.map(userWalletShape),
      total: wallets.length,
    });
  } catch (error) {
    console.error('Get my wallets error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

// ═════════════════════════════════════════════════════════════
// GET /secure-wallet/:id
// ═════════════════════════════════════════════════════════════
const getMyWalletById = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return sendNotFoundResponse(res, 'Wallet not found');
    }

    const wallet = await SecureWallet.findOne({
      _id: req.params.id,
      user: req.user.userId,
      status: 'active',
    });

    if (!wallet) return sendNotFoundResponse(res, 'Wallet not found');

    return sendSuccessResponseData(res, 'Wallet retrieved', {
      wallet: userWalletShape(wallet),
    });
  } catch (error) {
    console.error('Get wallet error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

// ═════════════════════════════════════════════════════════════
// PATCH /secure-wallet/:id/label
// Body: { label }
// ═════════════════════════════════════════════════════════════
const updateLabel = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return sendNotFoundResponse(res, 'Wallet not found');
    }

    const { label } = req.body;

    const wallet = await SecureWallet.findOne({
      _id: req.params.id,
      user: req.user.userId,
      status: 'active',
    });

    if (!wallet) return sendNotFoundResponse(res, 'Wallet not found');

    wallet.label = label ? String(label).trim().slice(0, MAX_LABEL_LENGTH) : '';
    await wallet.save();

    return sendSuccessResponseData(res, 'Label updated', {
      wallet: userWalletShape(wallet),
    });
  } catch (error) {
    console.error('Update wallet label error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

// ═════════════════════════════════════════════════════════════
// DELETE /secure-wallet/:id  → soft delete
// ═════════════════════════════════════════════════════════════
const deleteWallet = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return sendNotFoundResponse(res, 'Wallet not found');
    }

    const wallet = await SecureWallet.findOne({
      _id: req.params.id,
      user: req.user.userId,
      status: 'active',
    });

    if (!wallet) return sendNotFoundResponse(res, 'Wallet not found');

    wallet.status = 'archived';
    await wallet.save();

    return sendSuccessResponseData(res, 'Wallet deleted', null);
  } catch (error) {
    console.error('Delete wallet error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

module.exports = {
  getStatus,
  importWallet,
  getMyWallets,
  getMyWalletById,
  updateLabel,
  deleteWallet,
};