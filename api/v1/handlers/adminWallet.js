// app/v1/handlers/adminWallet.js
const SystemWallet = require('../models/systemWallet');
const {
  sendSuccessResponseData,
  sendBadRequestResponse,
  sendNotFoundResponse,
  sendConflictResponse,
  sendUnauthenticatedErrorResponse,
} = require('../responses');

/*
|--------------------------------------------------------------------------
| GET ALL SYSTEM WALLETS
|--------------------------------------------------------------------------
*/
const getAllSystemWallets = async (req, res) => {
  try {
    const { currency, isActive } = req.query;

    const query = {};
    if (currency && currency !== 'all') query.currency = currency.toUpperCase();
    if (isActive === 'true') query.isActive = true;
    if (isActive === 'false') query.isActive = false;

    const wallets = await SystemWallet.find(query)
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email')
      .sort({ sortOrder: 1, currency: 1 });

    return sendSuccessResponseData(
      res,
      'System wallets retrieved successfully',
      { wallets, total: wallets.length },
      200
    );
  } catch (error) {
    console.error('Get all system wallets error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| GET SYSTEM WALLET BY ID
|--------------------------------------------------------------------------
*/
const getSystemWalletById = async (req, res) => {
  try {
    const wallet = await SystemWallet.findById(req.params.id);
    if (!wallet) return sendNotFoundResponse(res, 'System wallet not found');

    return sendSuccessResponseData(res, 'System wallet retrieved', { wallet }, 200);
  } catch (error) {
    console.error('Get system wallet error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| CREATE SYSTEM WALLET
|--------------------------------------------------------------------------
*/
const createSystemWallet = async (req, res) => {
  try {
    const {
      currency,
      name,
      network,
      address,
      emoji,
      color,
      minDeposit,
      requiredConfirmations,
      isActive,
      sortOrder,
    } = req.body;

    if (!currency || !name || !network || !address) {
      return sendBadRequestResponse(res, 'Currency, name, network, and address are required');
    }

    const existing = await SystemWallet.findOne({
      currency: currency.toUpperCase().trim(),
      network: network.trim(),
    });
    if (existing) {
      return sendConflictResponse(
        res,
        `A wallet for ${currency} on ${network} already exists`
      );
    }

    const wallet = await SystemWallet.create({
      currency: currency.toUpperCase().trim(),
      name: name.trim(),
      network: network.trim(),
      address: address.trim(),
      emoji: emoji || '₿',
      color: color || '#F7931A',
      minDeposit: minDeposit || 20,
      requiredConfirmations: requiredConfirmations || 2,
      isActive: isActive !== undefined ? isActive : true,
      sortOrder: sortOrder || 0,
      createdBy: req.user.userId,
      updatedBy: req.user.userId,
    });

    return sendSuccessResponseData(res, 'System wallet created successfully', { wallet }, 201);
  } catch (error) {
    console.error('Create system wallet error:', error);
    if (error.code === 11000) {
      return sendConflictResponse(res, 'A wallet with this currency+network already exists');
    }
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| UPDATE SYSTEM WALLET
|--------------------------------------------------------------------------
*/
const updateSystemWallet = async (req, res) => {
  try {
    const wallet = await SystemWallet.findById(req.params.id);
    if (!wallet) return sendNotFoundResponse(res, 'System wallet not found');

    const {
      currency,
      name,
      network,
      address,
      emoji,
      color,
      minDeposit,
      requiredConfirmations,
      isActive,
      sortOrder,
    } = req.body;

    const newCurrency = currency ? currency.toUpperCase().trim() : wallet.currency;
    const newNetwork = network ? network.trim() : wallet.network;

    // Check duplicate if changed
    if (newCurrency !== wallet.currency || newNetwork !== wallet.network) {
      const existing = await SystemWallet.findOne({
        currency: newCurrency,
        network: newNetwork,
        _id: { $ne: wallet._id },
      });
      if (existing) {
        return sendConflictResponse(
          res,
          `A wallet for ${newCurrency} on ${newNetwork} already exists`
        );
      }
    }

    if (currency) wallet.currency = newCurrency;
    if (name) wallet.name = name.trim();
    if (network) wallet.network = newNetwork;
    if (address) wallet.address = address.trim();
    if (emoji !== undefined) wallet.emoji = emoji;
    if (color !== undefined) wallet.color = color;
    if (minDeposit !== undefined) wallet.minDeposit = minDeposit;
    if (requiredConfirmations !== undefined) wallet.requiredConfirmations = requiredConfirmations;
    if (isActive !== undefined) wallet.isActive = isActive;
    if (sortOrder !== undefined) wallet.sortOrder = sortOrder;

    wallet.updatedBy = req.user.userId;
    await wallet.save();

    return sendSuccessResponseData(res, 'System wallet updated successfully', { wallet }, 200);
  } catch (error) {
    console.error('Update system wallet error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| TOGGLE SYSTEM WALLET
|--------------------------------------------------------------------------
*/
const toggleSystemWallet = async (req, res) => {
  try {
    const wallet = await SystemWallet.findById(req.params.id);
    if (!wallet) return sendNotFoundResponse(res, 'System wallet not found');

    wallet.isActive = !wallet.isActive;
    wallet.updatedBy = req.user.userId;
    await wallet.save();

    return sendSuccessResponseData(
      res,
      `Wallet ${wallet.isActive ? 'activated' : 'deactivated'} successfully`,
      { wallet },
      200
    );
  } catch (error) {
    console.error('Toggle system wallet error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| DELETE SYSTEM WALLET
|--------------------------------------------------------------------------
*/
const deleteSystemWallet = async (req, res) => {
  try {
    const wallet = await SystemWallet.findByIdAndDelete(req.params.id);
    if (!wallet) return sendNotFoundResponse(res, 'System wallet not found');

    return sendSuccessResponseData(res, 'System wallet deleted successfully', null, 200);
  } catch (error) {
    console.error('Delete system wallet error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| SEED DEFAULT WALLETS
|--------------------------------------------------------------------------
*/
const seedDefaultWallets = async (req, res) => {
  try {
    const defaults = [
      { currency: 'BTC', name: 'Bitcoin', network: 'Bitcoin', emoji: '₿', color: '#F7931A', minDeposit: 50, requiredConfirmations: 2, sortOrder: 1 },
      { currency: 'ETH', name: 'Ethereum', network: 'ERC20', emoji: 'Ξ', color: '#627EEA', minDeposit: 50, requiredConfirmations: 12, sortOrder: 2 },
      { currency: 'USDT', name: 'Tether USD', network: 'TRC20', emoji: '₮', color: '#26A17B', minDeposit: 20, requiredConfirmations: 20, sortOrder: 3 },
      { currency: 'USDC', name: 'USD Coin', network: 'ERC20', emoji: '$', color: '#2775CA', minDeposit: 20, requiredConfirmations: 12, sortOrder: 4 },
      { currency: 'BNB', name: 'Binance Coin', network: 'BEP20', emoji: '⬢', color: '#F3BA2F', minDeposit: 20, requiredConfirmations: 15, sortOrder: 5 },
      { currency: 'SOL', name: 'Solana', network: 'Solana', emoji: '◎', color: '#14F195', minDeposit: 20, requiredConfirmations: 32, sortOrder: 6 },
    ];

    const created = [];
    for (const item of defaults) {
      const exists = await SystemWallet.findOne({
        currency: item.currency,
        network: item.network,
      });
      if (exists) continue;

      const wallet = await SystemWallet.create({
        ...item,
        address: 'REPLACE_WITH_REAL_ADDRESS',
        isActive: false,
        createdBy: req.user.userId,
        updatedBy: req.user.userId,
      });
      created.push(wallet);
    }

    return sendSuccessResponseData(
      res,
      `${created.length} wallets created. Update their addresses to activate.`,
      { wallets: created },
      201
    );
  } catch (error) {
    console.error('Seed wallets error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

module.exports = {
  getAllSystemWallets,
  getSystemWalletById,
  createSystemWallet,
  updateSystemWallet,
  toggleSystemWallet,
  deleteSystemWallet,
  seedDefaultWallets,
};