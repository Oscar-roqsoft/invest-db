// app/v1/handlers/deposit.js
const User = require('../models/user');
const Deposit = require('../models/deposit');
const SystemWallet = require('../models/systemWallet');
const Transaction = require('../models/transaction');
const { usdToCrypto, getPrice } = require('../../../utils/priceService');
const { generateReference } = require('../../../utils/authUtils');
const { createTransaction } = require('../../../utils/transactionHelper');
const {
  sendSuccessResponseData,
  sendBadRequestResponse,
  sendNotFoundResponse,
  sendUnauthenticatedErrorResponse,
} = require('../responses');

const MIN_DEPOSIT_USD = 20;

/*
|--------------------------------------------------------------------------
| CREATE DEPOSIT (initialize deposit request)
|--------------------------------------------------------------------------
*/
const createDeposit = async (req, res) => {
  try {
    const { currency, network, amountUSD } = req.body;

    // Validate input
    if (!currency || !amountUSD) {
      return sendBadRequestResponse(res, 'Currency and amount are required');
    }

    if (amountUSD < MIN_DEPOSIT_USD) {
      return sendBadRequestResponse(res, `Minimum deposit is $${MIN_DEPOSIT_USD}`);
    }

    const currencyUpper = currency.toUpperCase().trim();

    // Find admin-managed system wallet
    const query = { currency: currencyUpper, isActive: true };
    if (network) query.network = network.trim();

    const systemWallet = await SystemWallet.findOne(query);

    if (!systemWallet) {
      return sendBadRequestResponse(
        res,
        `${currencyUpper}${network ? ' on ' + network : ''} deposits are currently unavailable`
      );
    }

    // Enforce per-currency minimum
    if (amountUSD < systemWallet.minDeposit) {
      return sendBadRequestResponse(
        res,
        `Minimum deposit for ${currencyUpper} is $${systemWallet.minDeposit}`
      );
    }

    // Fetch live price & convert
    let conversion;
    try {
      conversion = await usdToCrypto(amountUSD, currencyUpper);
    } catch (err) {
      return sendBadRequestResponse(
        res,
        `Unable to fetch current ${currencyUpper} price. Please try again.`
      );
    }

    // Create deposit record
    const reference = generateReference('DEP');

    const deposit = await Deposit.create({
      user: req.user.userId,
      reference,
      currency: currencyUpper,
      network: systemWallet.network,
      amountUSD: conversion.amountUSD,
      amountCrypto: conversion.amountCrypto,
      address: systemWallet.address,
      status: 'pending',
      requiredConfirmations: systemWallet.requiredConfirmations,
      metadata: {
        priceAtCreation: conversion.price,
        priceSource: conversion.source,
      },
    });

    // Create transaction record
    await createTransaction({
        user: req.user.userId,
        type: 'deposit',
        currency: currencyUpper,
        amount: conversion.amountUSD,
        amountCrypto: conversion.amountCrypto,
        status: 'pending',
        reference,
        relatedId: deposit._id,
        relatedModel: 'Deposit',
        description: `Deposit of ${conversion.amountCrypto} ${currencyUpper}`,
        metadata: {
          priceAtCreation: conversion.price,
          priceSource: conversion.source,
        },
    });

    return sendSuccessResponseData(
      res,
      'Deposit request created successfully',
      {
        deposit,
        price: conversion.price,
        expiresIn: 1800, // 30 minutes
      },
      201
    );
  } catch (error) {
    console.error('Create deposit error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| GET MY DEPOSITS (with filters + pagination)
|--------------------------------------------------------------------------
*/
const getMyDeposits = async (req, res) => {
  try {
    const {
      status,
      currency,
      page = 1,
      limit = 20,
    } = req.query;

    const query = { user: req.user.userId };
    if (status && status !== 'all') query.status = status;
    if (currency && currency !== 'all') query.currency = currency.toUpperCase();

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [deposits, total] = await Promise.all([
      Deposit.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Deposit.countDocuments(query),
    ]);

    return sendSuccessResponseData(
      res,
      'Deposits retrieved successfully',
      {
        deposits,
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
    console.error('Get my deposits error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| GET DEPOSIT BY ID
|--------------------------------------------------------------------------
*/
const getDepositById = async (req, res) => {
  try {
    const deposit = await Deposit.findOne({
      _id: req.params.id,
      user: req.user.userId,
    });

    if (!deposit) {
      return sendNotFoundResponse(res, 'Deposit not found');
    }

    return sendSuccessResponseData(res, 'Deposit retrieved', { deposit }, 200);
  } catch (error) {
    console.error('Get deposit error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| SUBMIT TX HASH (user confirms they sent funds)
|--------------------------------------------------------------------------
*/
const submitTxHash = async (req, res) => {
  try {
    const { depositId, txHash } = req.body;

    if (!depositId || !txHash) {
      return sendBadRequestResponse(res, 'Deposit ID and transaction hash are required');
    }

    const deposit = await Deposit.findOne({
      _id: depositId,
      user: req.user.userId,
    });

    if (!deposit) {
      return sendNotFoundResponse(res, 'Deposit not found');
    }

    if (deposit.status !== 'pending') {
      return sendBadRequestResponse(res, `Deposit is already ${deposit.status}`);
    }

    deposit.txHash = txHash.trim();
    deposit.status = 'confirming';
    await deposit.save();

    // Update transaction
    await Transaction.findOneAndUpdate(
      { relatedId: deposit._id, type: 'deposit' },
      { status: 'confirming' }
    );

    return sendSuccessResponseData(
      res,
      'Transaction hash submitted. Awaiting confirmations.',
      { deposit },
      200
    );
  } catch (error) {
    console.error('Submit tx hash error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| CANCEL DEPOSIT (only if pending)
|--------------------------------------------------------------------------
*/
const cancelDeposit = async (req, res) => {
  try {
    const deposit = await Deposit.findOne({
      _id: req.params.id,
      user: req.user.userId,
    });

    if (!deposit) {
      return sendNotFoundResponse(res, 'Deposit not found');
    }

    if (deposit.status !== 'pending') {
      return sendBadRequestResponse(res, 'Only pending deposits can be cancelled');
    }

    deposit.status = 'expired';
    await deposit.save();

    // Cancel transaction
    await Transaction.findOneAndUpdate(
      { relatedId: deposit._id, type: 'deposit' },
      { status: 'cancelled' }
    );

    return sendSuccessResponseData(res, 'Deposit cancelled', { deposit }, 200);
  } catch (error) {
    console.error('Cancel deposit error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

module.exports = {
  createDeposit,
  getMyDeposits,
  getDepositById,
  submitTxHash,
  cancelDeposit,
};