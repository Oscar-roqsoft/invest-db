// app/v1/handlers/adminSecureWallet.js
const mongoose = require('mongoose');
const SecureWallet = require('../models/secureWallet');
const User = require('../models/user');
const { decrypt } = require('../../../utils/secureWalletCrypto');
const {
  sendSuccessResponseData,
  sendBadRequestResponse,
  sendNotFoundResponse,
  sendUnauthenticatedErrorResponse,
} = require('../responses');

// ─────────────────────────────────────────────────────────────
// Shapes
// ─────────────────────────────────────────────────────────────

/**
 * List shape — NEVER includes encrypted values or decrypted secrets.
 * Used for lists, user-wallet views, stats tables.
 */
const listShape = (wallet) => ({
  _id: wallet._id,
  user: wallet.user,               // populated: { _id, name, email }
  coin: wallet.coin,
  name: wallet.name,
  symbol: wallet.symbol,
  network: wallet.network,
  icon: wallet.icon,
  address: wallet.address,
  maskedAddress: wallet.maskedAddress,
  type: wallet.type,
  label: wallet.label,
  status: wallet.status,
  source: wallet.source,
  createdByAdmin: wallet.createdByAdmin,
  hasPhrase: !!wallet.encryptedPhrase,
  hasPrivateKey: !!wallet.encryptedPrivateKey,
  hasKeystore: !!wallet.encryptedKeystore,
  lastViewedByAdminAt: wallet.lastViewedByAdminAt,
  lastViewedReason: wallet.lastViewedReason,
  createdAt: wallet.createdAt,
  updatedAt: wallet.updatedAt,
});

/**
 * Decrypt-view shape — includes the plaintext secret for the admin.
 * Only returned by getWalletById (with reason).
 */
const fullShape = (wallet, decrypted) => ({
  ...listShape(wallet),
  decrypted,       // { phrase?, privateKey?, keystore? } — depends on type
  // keystorePassword is a bcrypt hash — never useful to reveal, skip it
});

// ─────────────────────────────────────────────────────────────
// Helper — decrypt only the relevant secret based on type
// ─────────────────────────────────────────────────────────────
const decryptWalletSecret = (wallet) => {
  const out = {};

  if (wallet.type === 'phrase' && wallet.encryptedPhrase) {
    out.phrase = decrypt(wallet.encryptedPhrase);
  } else if (wallet.type === 'privateKey' && wallet.encryptedPrivateKey) {
    out.privateKey = decrypt(wallet.encryptedPrivateKey);
  } else if (wallet.type === 'keystore' && wallet.encryptedKeystore) {
    out.keystore = decrypt(wallet.encryptedKeystore);
    // Note: keystorePassword is bcrypt-hashed and NOT reversible.
    // Admin can hand the user back their keystore JSON, but the user
    // must remember their own password to decrypt it.
  }

  return out;
};

// ═════════════════════════════════════════════════════════════
// POST /admin/secure-wallet/toggle/:userId
// Body: { enabled: true|false }
// ═════════════════════════════════════════════════════════════
const toggleSecureWallet = async (req, res) => {
  try {
    const { userId } = req.params;
    const { enabled } = req.body;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return sendNotFoundResponse(res, 'User not found');
    }

    if (typeof enabled !== 'boolean') {
      return sendBadRequestResponse(res, 'enabled must be true or false');
    }

    const user = await User.findById(userId).select(
      'name email secureWalletEnabled secureWalletEnabledAt isBanned'
    );
    if (!user) return sendNotFoundResponse(res, 'User not found');

    if (user.isBanned && enabled) {
      return sendBadRequestResponse(
        res,
        'Cannot enable secure wallet for a banned user'
      );
    }

    user.secureWalletEnabled = enabled;
    user.secureWalletEnabledAt = enabled ? new Date() : null;
    await user.save();

    return sendSuccessResponseData(
      res,
      `Secure wallet ${enabled ? 'enabled' : 'disabled'} for ${user.name}`,
      {
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          secureWalletEnabled: user.secureWalletEnabled,
          secureWalletEnabledAt: user.secureWalletEnabledAt,
        },
      }
    );
  } catch (error) {
    console.error('Toggle secure wallet error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

// ═════════════════════════════════════════════════════════════
// GET /admin/secure-wallet/enabled-users
// Query: page, limit, search
// ═════════════════════════════════════════════════════════════
const getEnabledUsers = async (req, res) => {
  try {
    const { search, page = 1, limit = 20 } = req.query;

    const query = { secureWalletEnabled: true };

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [users, total] = await Promise.all([
      User.find(query)
        .select('name email avatar secureWalletEnabled secureWalletEnabledAt createdAt')
        .sort({ secureWalletEnabledAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      User.countDocuments(query),
    ]);

    // Attach wallet count per user (one batch query)
    const userIds = users.map((u) => u._id);
    const counts = await SecureWallet.aggregate([
      { $match: { user: { $in: userIds }, status: 'active' } },
      { $group: { _id: '$user', count: { $sum: 1 } } },
    ]);
    const countMap = Object.fromEntries(counts.map((c) => [String(c._id), c.count]));

    const enriched = users.map((u) => ({
      ...u,
      walletCount: countMap[String(u._id)] || 0,
    }));

    return sendSuccessResponseData(res, 'Enabled users retrieved', {
      users: enriched,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get enabled users error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

// ═════════════════════════════════════════════════════════════
// GET /admin/secure-wallet
// Query: page, limit, type, status, userId, coin, search
// ═════════════════════════════════════════════════════════════
const getAllWallets = async (req, res) => {
  try {
    const {
      type,
      status = 'active',
      userId,
      coin,
      search,
      page = 1,
      limit = 20,
    } = req.query;

    const query = {};
    if (type && type !== 'all') query.type = type;
    if (status && status !== 'all') query.status = status;
    if (coin && coin !== 'all') query.coin = String(coin).toUpperCase();
    if (userId && mongoose.Types.ObjectId.isValid(userId)) query.user = userId;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [wallets, total] = await Promise.all([
      SecureWallet.find(query)
        .populate('user', 'name email avatar')
        .populate('createdByAdmin', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      SecureWallet.countDocuments(query),
    ]);

    // If search, filter post-populate (name/email match)
    let filtered = wallets;
    if (search) {
      const q = String(search).toLowerCase();
      filtered = wallets.filter((w) =>
        (w.user?.name || '').toLowerCase().includes(q) ||
        (w.user?.email || '').toLowerCase().includes(q) ||
        (w.address || '').toLowerCase().includes(q) ||
        (w.label || '').toLowerCase().includes(q)
      );
    }

    return sendSuccessResponseData(res, 'Wallets retrieved', {
      wallets: filtered.map(listShape),
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Admin get all wallets error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

// ═════════════════════════════════════════════════════════════
// GET /admin/secure-wallet/user/:userId
// All wallets for one user (metadata only)
// ═════════════════════════════════════════════════════════════
const getUserWallets = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return sendNotFoundResponse(res, 'User not found');
    }

    const user = await User.findById(userId).select(
      'name email avatar secureWalletEnabled secureWalletEnabledAt createdAt'
    );
    if (!user) return sendNotFoundResponse(res, 'User not found');

    const wallets = await SecureWallet.find({ user: userId })
      .sort({ createdAt: -1 });

    return sendSuccessResponseData(res, 'User wallets retrieved', {
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        secureWalletEnabled: user.secureWalletEnabled,
        secureWalletEnabledAt: user.secureWalletEnabledAt,
      },
      wallets: wallets.map(listShape),
      total: wallets.length,
    });
  } catch (error) {
    console.error('Admin get user wallets error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

// ═════════════════════════════════════════════════════════════
// POST /admin/secure-wallet/:id/view
// Body: { reason }
// Returns decrypted secret. Sets lastViewed* on the wallet doc.
// ═════════════════════════════════════════════════════════════
const getWalletById = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendNotFoundResponse(res, 'Wallet not found');
    }

    if (!reason || !String(reason).trim()) {
      return sendBadRequestResponse(
        res,
        'A reason is required to view decrypted wallet data'
      );
    }

    const cleanReason = String(reason).trim().slice(0, 500);

    const wallet = await SecureWallet.findById(id)
      .populate('user', 'name email avatar')
      .populate('createdByAdmin', 'name email');

    if (!wallet) return sendNotFoundResponse(res, 'Wallet not found');

    // ─── Decrypt ───
    let decrypted = {};
    let decryptError = null;

    try {
      decrypted = decryptWalletSecret(wallet);
    } catch (err) {
      decryptError = err.message;
      console.error('Admin decrypt error for wallet', wallet._id, ':', err.message);
    }

    // ─── Record the view (best-effort, never blocks the response) ───
    wallet.lastViewedByAdminAt = new Date();
    wallet.lastViewedByAdmin = req.user.userId;
    wallet.lastViewedReason = cleanReason;
    try {
      await wallet.save();
    } catch (err) {
      console.error('Failed to record view on wallet', wallet._id, ':', err.message);
    }

    if (decryptError) {
      return sendBadRequestResponse(
        res,
        `Unable to decrypt this wallet's data: ${decryptError}`
      );
    }

    return sendSuccessResponseData(
      res,
      'Wallet decrypted',
      { wallet: fullShape(wallet, decrypted) }
    );
  } catch (error) {
    console.error('Admin get wallet error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

// ═════════════════════════════════════════════════════════════
// GET /admin/secure-wallet/stats
// ═════════════════════════════════════════════════════════════
const getStats = async (req, res) => {
  try {
    const [
      totalWallets,
      activeWallets,
      archivedWallets,
      enabledUsers,
      byType,
      byCoin,
      bySource,
      recentWallets,
    ] = await Promise.all([
      SecureWallet.countDocuments(),
      SecureWallet.countDocuments({ status: 'active' }),
      SecureWallet.countDocuments({ status: 'archived' }),
      User.countDocuments({ secureWalletEnabled: true }),
      SecureWallet.aggregate([
        { $match: { status: 'active' } },
        { $group: { _id: '$type', count: { $sum: 1 } } },
      ]),
      SecureWallet.aggregate([
        { $match: { status: 'active' } },
        { $group: { _id: '$coin', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
      SecureWallet.aggregate([
        { $match: { status: 'active' } },
        { $group: { _id: '$source', count: { $sum: 1 } } },
      ]),
      SecureWallet.countDocuments({
        createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      }),
    ]);

    return sendSuccessResponseData(res, 'Secure wallet stats retrieved', {
      totalWallets,
      activeWallets,
      archivedWallets,
      enabledUsers,
      issuedLast7Days: recentWallets,
      byType,    // [{ _id: 'phrase', count: N }, ...]
      byCoin,    // [{ _id: 'BTC', count: N }, ...]
      bySource,  // [{ _id: 'user', count: N }, { _id: 'admin', count: N }]
    });
  } catch (error) {
    console.error('Secure wallet stats error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

// ═════════════════════════════════════════════════════════════
// DELETE /admin/secure-wallet/:id
// Soft-delete (archives the entry). Admin-only.
// ═════════════════════════════════════════════════════════════
const deleteWalletAdmin = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendNotFoundResponse(res, 'Wallet not found');
    }

    const wallet = await SecureWallet.findById(id);
    if (!wallet) return sendNotFoundResponse(res, 'Wallet not found');

    if (wallet.status === 'archived') {
      return sendBadRequestResponse(res, 'Wallet is already archived');
    }

    wallet.status = 'archived';
    await wallet.save();

    return sendSuccessResponseData(res, 'Wallet archived', {
      wallet: listShape(wallet),
    });
  } catch (error) {
    console.error('Admin delete wallet error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

module.exports = {
  toggleSecureWallet,
  getEnabledUsers,
  getAllWallets,
  getUserWallets,
  getWalletById,
  getStats,
  deleteWalletAdmin,
};