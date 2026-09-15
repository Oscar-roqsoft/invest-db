// app/v1/handlers/wallet.js
const User = require('../models/user');
const Wallet = require('../models/wallet');
const SystemWallet = require('../models/systemWallet');
const {
  sendSuccessResponseData,
  sendBadRequestResponse,
  sendNotFoundResponse,
  sendUnauthenticatedErrorResponse,
} = require('../responses');

/*
|--------------------------------------------------------------------------
| GET BALANCES
|--------------------------------------------------------------------------
*/
const getBalances = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) return sendNotFoundResponse(res, 'User not found');

    return sendSuccessResponseData(
      res,
      'Balances retrieved successfully',
      {
        balances: user.balances,
        totalUSD: user.balances.USD || 0,
      },
      200
    );
  } catch (error) {
    console.error('Get balances error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| GET WALLET STATS
|--------------------------------------------------------------------------
*/
const getWalletStats = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) return sendNotFoundResponse(res, 'User not found');

    return sendSuccessResponseData(
      res,
      'Wallet stats retrieved',
      {
        totalDeposits: user.totalDeposits || 0,
        totalWithdrawals: user.totalWithdrawals || 0,
        totalEarnings: user.totalEarnings || 0,
        totalInvestments: user.totalInvestments || 0,
        availableBalance: user.balances.USD || 0,
      },
      200
    );
  } catch (error) {
    console.error('Get wallet stats error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| GET DEPOSIT ADDRESSES (admin-managed, active only)
|--------------------------------------------------------------------------
*/
const getDepositAddresses = async (req, res) => {
  try {
    const wallets = await SystemWallet.find({ isActive: true })
      .select('-createdBy -updatedBy -__v')
      .sort({ sortOrder: 1, currency: 1 });

    return sendSuccessResponseData(
      res,
      'Deposit addresses retrieved',
      { addresses: wallets },
      200
    );
  } catch (error) {
    console.error('Get deposit addresses error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| GET DEPOSIT ADDRESS BY CURRENCY
|--------------------------------------------------------------------------
*/
const getDepositAddressByCurrency = async (req, res) => {
  try {
    const { currency } = req.params;

    const wallet = await SystemWallet.findOne({
      currency: currency.toUpperCase().trim(),
      isActive: true,
    }).select('-createdBy -updatedBy -__v');

    if (!wallet) {
      return sendNotFoundResponse(res, `${currency} deposits are currently unavailable`);
    }

    return sendSuccessResponseData(res, 'Deposit address retrieved', { wallet }, 200);
  } catch (error) {
    console.error('Get deposit address error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| GET SAVED WALLETS (user's own withdrawal addresses)
|--------------------------------------------------------------------------
*/
const getSavedWallets = async (req, res) => {
  try {
    const wallets = await Wallet.find({ user: req.user.userId })
      .sort({ isPrimary: -1, createdAt: -1 });

    return sendSuccessResponseData(res, 'Saved wallets retrieved', { wallets }, 200);
  } catch (error) {
    console.error('Get saved wallets error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| ADD SAVED WALLET
|--------------------------------------------------------------------------
*/
const addSavedWallet = async (req, res) => {
  try {
    const { currency, network, address, label, isPrimary } = req.body;

    if (!currency || !network || !address) {
      return sendBadRequestResponse(res, 'Currency, network, and address are required');
    }

    // Unset other primaries if setting as primary
    if (isPrimary) {
      await Wallet.updateMany(
        { user: req.user.userId, currency: currency.toUpperCase() },
        { isPrimary: false }
      );
    }

    const wallet = await Wallet.create({
      user: req.user.userId,
      currency: currency.toUpperCase().trim(),
      network: network.trim(),
      address: address.trim(),
      label: label || '',
      isPrimary: !!isPrimary,
    });

    return sendSuccessResponseData(res, 'Wallet added successfully', { wallet }, 201);
  } catch (error) {
    if (error.code === 11000) {
      return sendBadRequestResponse(res, 'This wallet address is already saved');
    }
    console.error('Add saved wallet error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| UPDATE SAVED WALLET
|--------------------------------------------------------------------------
*/
const updateSavedWallet = async (req, res) => {
  try {
    const { label, isPrimary } = req.body;

    const wallet = await Wallet.findOne({
      _id: req.params.id,
      user: req.user.userId,
    });

    if (!wallet) return sendNotFoundResponse(res, 'Wallet not found');

    if (isPrimary) {
      await Wallet.updateMany(
        { user: req.user.userId, currency: wallet.currency, _id: { $ne: wallet._id } },
        { isPrimary: false }
      );
    }

    if (label !== undefined) wallet.label = label;
    if (isPrimary !== undefined) wallet.isPrimary = isPrimary;

    await wallet.save();

    return sendSuccessResponseData(res, 'Wallet updated successfully', { wallet }, 200);
  } catch (error) {
    console.error('Update saved wallet error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| DELETE SAVED WALLET
|--------------------------------------------------------------------------
*/
const deleteSavedWallet = async (req, res) => {
  try {
    const wallet = await Wallet.findOneAndDelete({
      _id: req.params.id,
      user: req.user.userId,
    });

    if (!wallet) return sendNotFoundResponse(res, 'Wallet not found');

    return sendSuccessResponseData(res, 'Wallet deleted successfully', null, 200);
  } catch (error) {
    console.error('Delete saved wallet error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};



/*
|--------------------------------------------------------------------------
| GET ALL SYSTEM WALLETS (user-facing)
|--------------------------------------------------------------------------
| 
|--------------------------------------------------------------------------
*/
const getAllSystemWallets = async (req, res) => {
  try {
    const { currency } = req.query;

    const query = { isActive: true };
    if (currency && currency !== 'all') {
      query.currency = currency.toUpperCase().trim();
    }

    const wallets = await SystemWallet.find(query)
      .select('-createdBy -updatedBy -__v')
      .sort({ sortOrder: 1, currency: 1 });

    return sendSuccessResponseData(
      res,
      'System wallets retrieved successfully',
      { wallets, total: wallets.length },
      200
    );
  } catch (error) {
    console.error('Get system wallets error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| GET SYSTEM WALLET BY ID (user-facing)
|--------------------------------------------------------------------------
|--------------------------------------------------------------------------
*/
const getSystemWalletById = async (req, res) => {
  try {
    const wallet = await SystemWallet.findOne({
      _id: req.params.id,
      isActive: true,
    }).select('-createdBy -updatedBy -__v');

    if (!wallet) return sendNotFoundResponse(res, 'Wallet not found or unavailable');

    return sendSuccessResponseData(res, 'System wallet retrieved', { wallet }, 200);
  } catch (error) {
    console.error('Get system wallet error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

module.exports = {
  getBalances,
  getWalletStats,
  getDepositAddresses,
  getDepositAddressByCurrency,
  getSavedWallets,
  addSavedWallet,
  updateSavedWallet,
  deleteSavedWallet,
  getAllSystemWallets,
  getSystemWalletById,
};