// app/v1/handlers/adminUser.js
const User = require('../models/user');
const {
  sendSuccessResponseData,
  sendBadRequestResponse,
  sendNotFoundResponse,
  sendUnauthenticatedErrorResponse,
} = require('../responses');
const SystemWallet = require('../models/systemWallet');
const { usdToCrypto } = require('../../../utils/cryptoUtils');
const mongoose = require('mongoose');
const Transaction = require('../models/transaction');

// mmm

const MANUAL_ADJUSTMENT_MAX_USD = 1_000_000;
const MANUAL_ADJUSTMENT_MIN_USD = 0.01;
const REASON_MIN_LENGTH = 3;
const REASON_MAX_LENGTH = 500;

/*
|--------------------------------------------------------------------------
| GET ALL USERS (admin)
|--------------------------------------------------------------------------
*/
const getAllUsers = async (req, res) => {
  try {
    const {
      search,
      role,
      kycStatus,
      isBanned,
      isVerified,
      page = 1,
      limit = 20,
      sort = 'newest',
    } = req.query;

    const query = {};
    if (role && role !== 'all') query.role = role;
    if (kycStatus && kycStatus !== 'all') query['kyc.status'] = kycStatus;
    if (isBanned === 'true') query.isBanned = true;
    if (isBanned === 'false') query.isBanned = false;
    if (isVerified === 'true') query.isVerified = true;
    if (isVerified === 'false') query.isVerified = false;

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
      ];
    }

    const sortMap = {
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      name: { name: 1 },
      balance: { 'balances.USD': -1 },
    };

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [users, total] = await Promise.all([
      User.find(query)
        .select('-password -pin -resetPasswordToken -resetPasswordExpire')
        .sort(sortMap[sort] || sortMap.newest)
        .skip(skip)
        .limit(parseInt(limit)),
      User.countDocuments(query),
    ]);

    return sendSuccessResponseData(
      res,
      'Users retrieved',
      {
        users,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / parseInt(limit)),
        },
      },
      200
    );
  } catch (error) {
    console.error('Get all users error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| GET USER BY ID (admin)
|--------------------------------------------------------------------------
*/
const getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select(
      '-password -pin -resetPasswordToken -resetPasswordExpire'
    );
    if (!user) return sendNotFoundResponse(res, 'User not found');

    return sendSuccessResponseData(res, 'User retrieved', { user }, 200);
  } catch (error) {
    console.error('Get user error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| BAN / UNBAN USER (admin)
|--------------------------------------------------------------------------
*/
const setBanStatus = async (req, res) => {
  try {
    const { isBanned, reason } = req.body;

    if (isBanned === undefined) {
      return sendBadRequestResponse(res, 'isBanned flag is required');
    }

    const user = await User.findById(req.params.id);
    if (!user) return sendNotFoundResponse(res, 'User not found');
    if (user.role === 'admin') {
      return sendBadRequestResponse(res, 'Cannot ban admin accounts');
    }

    user.isBanned = !!isBanned;
    if (user.isBanned && reason) {
      user.banReason = String(reason).trim().slice(0, 500);
    }
    await user.save();

    return sendSuccessResponseData(
      res,
      `User ${user.isBanned ? 'banned' : 'unbanned'}`,
      { user: { _id: user._id, isBanned: user.isBanned } },
      200
    );
  } catch (error) {
    console.error('Ban user error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| APPROVE / REJECT KYC (admin)
|--------------------------------------------------------------------------
*/
const reviewKYC = async (req, res) => {
  try {
    const { status, rejectionReason } = req.body;

    if (!status || !['approved', 'rejected'].includes(status)) {
      return sendBadRequestResponse(res, 'status must be "approved" or "rejected"');
    }

    if (status === 'rejected' && !rejectionReason) {
      return sendBadRequestResponse(res, 'Rejection reason is required');
    }

    const user = await User.findById(req.params.id);
    if (!user) return sendNotFoundResponse(res, 'User not found');
    if (user.kyc?.status !== 'pending') {
      return sendBadRequestResponse(res, `KYC is not pending (current: ${user.kyc?.status})`);
    }

    user.kyc.status = status;
    user.kyc.reviewedAt = new Date();
    user.kyc.reviewedBy = req.user.userId;

    if (status === 'rejected') {
      user.kyc.rejectionReason = String(rejectionReason).trim().slice(0, 500);
    }

    await user.save();

    return sendSuccessResponseData(res, `KYC ${status}`, { kyc: user.kyc }, 200);
  } catch (error) {
    console.error('Review KYC error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| UPDATE USER BY ADMIN (limited fields)
|--------------------------------------------------------------------------
*/
const adminUpdateUser = async (req, res) => {
  try {
    const allowed = ['name', 'phone', 'country', 'role', 'isVerified'];
    const updates = {};

    allowed.forEach((key) => {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    });

    if (updates.role && !['user', 'admin'].includes(updates.role)) {
      return sendBadRequestResponse(res, 'Invalid role');
    }

    const user = await User.findByIdAndUpdate(req.params.id, updates, { new: true }).select(
      '-password -pin -resetPasswordToken -resetPasswordExpire'
    );
    if (!user) return sendNotFoundResponse(res, 'User not found');

    return sendSuccessResponseData(res, 'User updated', { user }, 200);
  } catch (error) {
    console.error('Admin update user error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| USER STATS (admin dashboard)
|--------------------------------------------------------------------------
*/
const getUserStats = async (req, res) => {
  try {
    const [total, verified, banned, kycPending, kycApproved, newThisMonth] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ isVerified: true }),
      User.countDocuments({ isBanned: true }),
      User.countDocuments({ 'kyc.status': 'pending' }),
      User.countDocuments({ 'kyc.status': 'approved' }),
      User.countDocuments({
        createdAt: { $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
      }),
    ]);

    return sendSuccessResponseData(
      res,
      'User stats retrieved',
      {
        total,
        verified,
        banned,
        kycPending,
        kycApproved,
        newThisMonth,
        unverified: total - verified,
      },
      200
    );
  } catch (error) {
    console.error('User stats error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};


// ═════════════════════════════════════════════════════════════
// MANUAL ADJUSTMENTS
// ═════════════════════════════════════════════════════════════

/*
|--------------------------------------------------------------------------
| MANUAL CREDIT (admin credits a user's USD balance)
|--------------------------------------------------------------------------
| Body: { amount: number, reason: string, sendEmail?: boolean }
| Never fires referral commission. Creates a Transaction record.
|--------------------------------------------------------------------------
*/

const manualCredit = async (req, res) => {
  try {
    const { userId } = req.params;
    const {
      currency,
      network,
      amountUSD,
      reason,
      sendEmail = true,
    } = req.body;

    // ─── Validate user ID ───
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return sendNotFoundResponse(res, 'User not found');
    }

    // ─── Validate currency ───
    if (!currency) {
      return sendBadRequestResponse(res, 'Currency is required');
    }
    const currencyUpper = String(currency).toUpperCase().trim();

    // ─── Validate amount ───
    const amtUSD = Number(amountUSD);
    if (!Number.isFinite(amtUSD) || amtUSD < MANUAL_ADJUSTMENT_MIN_USD) {
      return sendBadRequestResponse(
        res,
        `Amount must be at least $${MANUAL_ADJUSTMENT_MIN_USD}`
      );
    }
    if (amtUSD > MANUAL_ADJUSTMENT_MAX_USD) {
      return sendBadRequestResponse(
        res,
        `Amount exceeds maximum ($${MANUAL_ADJUSTMENT_MAX_USD.toLocaleString()})`
      );
    }

    // ─── Validate reason ───
    const trimmedReason = String(reason || '').trim();
    if (trimmedReason.length < REASON_MIN_LENGTH) {
      return sendBadRequestResponse(
        res,
        `Reason is required (minimum ${REASON_MIN_LENGTH} characters)`
      );
    }
    if (trimmedReason.length > REASON_MAX_LENGTH) {
      return sendBadRequestResponse(
        res,
        `Reason too long (maximum ${REASON_MAX_LENGTH} characters)`
      );
    }

    // ─── Load user ───
    const user = await User.findById(userId);
    if (!user) return sendNotFoundResponse(res, 'User not found');
    if (user.isBanned) {
      return sendBadRequestResponse(res, 'Cannot credit a banned user');
    }

    // ─── Verify currency is supported (has active SystemWallet) ───
    const sysQuery = { currency: currencyUpper, isActive: true };
    if (network) sysQuery.network = String(network).trim();

    const systemWallet = await SystemWallet.findOne(sysQuery);
    if (!systemWallet) {
      return sendBadRequestResponse(
        res,
        `${currencyUpper}${network ? ' on ' + network : ''} is not available`
      );
    }

    const resolvedNetwork = systemWallet.network;

    // ─── Convert USD → crypto using live price ───
    let conversion;
    try {
      conversion = await usdToCrypto(amtUSD, currencyUpper);
    } catch (err) {
      return sendBadRequestResponse(
        res,
        `Unable to fetch current ${currencyUpper} price. Please try again.`
      );
    }

    // ─── Compute new balances ───
    const balanceBeforeUSD = Number(user.balances?.USD || 0);
    const balanceBeforeCoin = Number(user.balances?.[currencyUpper] || 0);
    const balanceAfterUSD = balanceBeforeUSD + conversion.amountUSD;
    const balanceAfterCoin = balanceBeforeCoin + conversion.amountCrypto;

    user.balances.USD = balanceAfterUSD;
    user.balances[currencyUpper] = balanceAfterCoin;
    user.totalDeposits = (user.totalDeposits || 0) + conversion.amountUSD;
    user.markModified('balances'); // ensure nested object is saved
    await user.save();

    // ─── Create transaction ───
    const reference = `MDEP-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

    const transaction = await Transaction.create({
      user: user._id,
      type: 'deposit',
      direction: 'credit',
      currency: currencyUpper,
      amount: conversion.amountUSD,
      amountCrypto: conversion.amountCrypto,
      balanceAfter: balanceAfterUSD,
      status: 'completed',
      reference,
      description: `Manual ${currencyUpper} credit by admin`,
      completedAt: new Date(),
      metadata: {
        manual: true,
        adminId: req.user.userId,
        adminName: req.user.name || 'admin',
        reason: trimmedReason,
        network: resolvedNetwork,
        balanceBeforeUSD,
        balanceAfterUSD,
        balanceBeforeCoin,
        balanceAfterCoin,
        priceAtCredit: conversion.price,
        priceSource: conversion.source,
      },
    });

    // ─── Send email ───
    // if (sendEmail) {
    //   sendTransactionEmail(user, {
    //     type: 'Account Credit',
    //     amount: conversion.amountCrypto,
    //     crypto: currencyUpper,
    //     status: 'Completed',
    //     reference,
    //   }).catch((err) =>
    //     console.error('Manual credit email error:', err.message)
    //   );
    // }

    return sendSuccessResponseData(
      res,
      `$${conversion.amountUSD.toFixed(2)} (${conversion.amountCrypto} ${currencyUpper}) credited to ${user.name}`,
      {
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          balances: user.balances,
          totalDeposits: user.totalDeposits,
        },
        transaction: {
          _id: transaction._id,
          reference: transaction.reference,
          currency: currencyUpper,
          network: resolvedNetwork,
          amount: conversion.amountUSD,
          amountCrypto: conversion.amountCrypto,
          balanceAfter: balanceAfterUSD,
        },
        balanceBeforeUSD,
        balanceAfterUSD,
        balanceBeforeCoin,
        balanceAfterCoin,
        price: conversion.price,
      },
      200
    );
  } catch (error) {
    console.error('Manual credit error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| MANUAL DEBIT (admin debits a user's balance in a specific currency)
|--------------------------------------------------------------------------
| Body: {
|   currency: 'BTC' | 'ETH' | ... ,
|   network?: string,
|   amountUSD: number,
|   reason: string,
|   sendEmail?: boolean
| }
|
| Debits BOTH balances.USD and balances[currency].
| Fails if user's USD balance OR coin balance would go negative.
|--------------------------------------------------------------------------
*/
const manualDebit = async (req, res) => {
  try {
    const { userId } = req.params;
    const {
      currency,
      network,
      amountUSD,
      reason,
      sendEmail = true,
    } = req.body;

    // ─── Validate user ID ───
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return sendNotFoundResponse(res, 'User not found');
    }

    // ─── Validate currency ───
    if (!currency) {
      return sendBadRequestResponse(res, 'Currency is required');
    }
    const currencyUpper = String(currency).toUpperCase().trim();

    // ─── Validate amount ───
    const amtUSD = Number(amountUSD);
    if (!Number.isFinite(amtUSD) || amtUSD < MANUAL_ADJUSTMENT_MIN_USD) {
      return sendBadRequestResponse(
        res,
        `Amount must be at least $${MANUAL_ADJUSTMENT_MIN_USD}`
      );
    }
    if (amtUSD > MANUAL_ADJUSTMENT_MAX_USD) {
      return sendBadRequestResponse(
        res,
        `Amount exceeds maximum ($${MANUAL_ADJUSTMENT_MAX_USD.toLocaleString()})`
      );
    }

    // ─── Validate reason ───
    const trimmedReason = String(reason || '').trim();
    if (trimmedReason.length < REASON_MIN_LENGTH) {
      return sendBadRequestResponse(
        res,
        `Reason is required (minimum ${REASON_MIN_LENGTH} characters)`
      );
    }
    if (trimmedReason.length > REASON_MAX_LENGTH) {
      return sendBadRequestResponse(
        res,
        `Reason too long (maximum ${REASON_MAX_LENGTH} characters)`
      );
    }

    // ─── Load user ───
    const user = await User.findById(userId);
    if (!user) return sendNotFoundResponse(res, 'User not found');
    if (user.isBanned) {
      return sendBadRequestResponse(res, 'Cannot debit a banned user');
    }

    // ─── Verify currency is supported ───
    const sysQuery = { currency: currencyUpper, isActive: true };
    if (network) sysQuery.network = String(network).trim();

    const systemWallet = await SystemWallet.findOne(sysQuery);
    if (!systemWallet) {
      return sendBadRequestResponse(
        res,
        `${currencyUpper}${network ? ' on ' + network : ''} is not available`
      );
    }

    const resolvedNetwork = systemWallet.network;

    // ─── Convert USD → crypto using live price ───
    let conversion;
    try {
      conversion = await usdToCrypto(amtUSD, currencyUpper);
    } catch (err) {
      return sendBadRequestResponse(
        res,
        `Unable to fetch current ${currencyUpper} price. Please try again.`
      );
    }

    // ─── Check BOTH balances ───
    const balanceBeforeUSD = Number(user.balances?.USD || 0);
    const balanceBeforeCoin = Number(user.balances?.[currencyUpper] || 0);

    if (conversion.amountUSD > balanceBeforeUSD) {
      return sendBadRequestResponse(
        res,
        `Insufficient USD balance. User has $${balanceBeforeUSD.toFixed(2)}, tried to debit $${conversion.amountUSD.toFixed(2)}`
      );
    }
    if (conversion.amountCrypto > balanceBeforeCoin) {
      return sendBadRequestResponse(
        res,
        `Insufficient ${currencyUpper} balance. User has ${balanceBeforeCoin} ${currencyUpper}, tried to debit ${conversion.amountCrypto} ${currencyUpper}`
      );
    }

    // ─── Apply ───
    const balanceAfterUSD = balanceBeforeUSD - conversion.amountUSD;
    const balanceAfterCoin = balanceBeforeCoin - conversion.amountCrypto;

    user.balances.USD = balanceAfterUSD;
    user.balances[currencyUpper] = balanceAfterCoin;
    user.totalWithdrawals = (user.totalWithdrawals || 0) + conversion.amountUSD;
    user.markModified('balances');
    await user.save();

    // ─── Create transaction ───
    const reference = `MWTH-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

    const transaction = await Transaction.create({
      user: user._id,
      type: 'withdrawal',
      direction: 'debit',
      currency: currencyUpper,
      amount: conversion.amountUSD,
      amountCrypto: conversion.amountCrypto,
      balanceAfter: balanceAfterUSD,
      status: 'completed',
      reference,
      description: `Manual ${currencyUpper} debit by admin`,
      completedAt: new Date(),
      metadata: {
        manual: true,
        adminId: req.user.userId,
        adminName: req.user.name || 'admin',
        reason: trimmedReason,
        network: resolvedNetwork,
        balanceBeforeUSD,
        balanceAfterUSD,
        balanceBeforeCoin,
        balanceAfterCoin,
        priceAtDebit: conversion.price,
        priceSource: conversion.source,
      },
    });

    // ─── Send email ───
    // if (sendEmail) {
    //   sendTransactionEmail(user, {
    //     type: 'Account Debit',
    //     amount: conversion.amountCrypto,
    //     crypto: currencyUpper,
    //     status: 'Completed',
    //     reference,
    //   }).catch((err) =>
    //     console.error('Manual debit email error:', err.message)
    //   );
    // }

    return sendSuccessResponseData(
      res,
      `$${conversion.amountUSD.toFixed(2)} (${conversion.amountCrypto} ${currencyUpper}) debited from ${user.name}`,
      {
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          balances: user.balances,
          totalWithdrawals: user.totalWithdrawals,
        },
        transaction: {
          _id: transaction._id,
          reference: transaction.reference,
          currency: currencyUpper,
          network: resolvedNetwork,
          amount: conversion.amountUSD,
          amountCrypto: conversion.amountCrypto,
          balanceAfter: balanceAfterUSD,
        },
        balanceBeforeUSD,
        balanceAfterUSD,
        balanceBeforeCoin,
        balanceAfterCoin,
        price: conversion.price,
      },
      200
    );
  } catch (error) {
    console.error('Manual debit error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

module.exports = {
  getAllUsers,
  getUserById,
  setBanStatus,
  reviewKYC,
  adminUpdateUser,
  getUserStats,
  manualCredit,
  manualDebit,
};