// app/v1/handlers/withdrawal.js
const User = require('../models/user');
const Withdrawal = require('../models/withdrawal');
const Transaction = require('../models/transaction');
const SystemWallet = require('../models/systemWallet');
const Wallet = require('../models/wallet');
const {
  usdToCrypto,
  cryptoToUsd,
  getPrice,
} = require('../../../utils/priceService');
const {
  calculateFees,
  MIN_WITHDRAWAL_USD,
  MIN_NET_AMOUNT_USD,
} = require('../../../config/withdrawalFees');
const { generateReference } = require('../../../utils/authUtils');
const {
  sendSuccessResponseData,
  sendBadRequestResponse,
  sendNotFoundResponse,
  sendUnauthenticatedErrorResponse,
} = require('../responses');

/*
|--------------------------------------------------------------------------
| CALCULATE WITHDRAWAL FEE (preview endpoint)
|--------------------------------------------------------------------------
| User enters amount, gets fee preview BEFORE submitting.
|--------------------------------------------------------------------------
*/
const calculateWithdrawalFee = async (req, res) => {
  try {
    const { currency, amountUSD } = req.body;

    if (!currency || !amountUSD) {
      return sendBadRequestResponse(res, 'Currency and amount are required');
    }

    const amount = parseFloat(amountUSD);
    if (amount < MIN_WITHDRAWAL_USD) {
      return sendBadRequestResponse(res, `Minimum withdrawal is $${MIN_WITHDRAWAL_USD}`);
    }

    const currencyUpper = currency.toUpperCase().trim();

    // Get live price
    const price = await getPrice(currencyUpper);
    if (!price) {
      return sendBadRequestResponse(res, `Unable to fetch ${currencyUpper} price`);
    }

    // Calculate fees
    const fees = calculateFees(amount, currencyUpper);

    if (fees.netAmountUSD < MIN_NET_AMOUNT_USD) {
      return sendBadRequestResponse(
        res,
        `Amount too small. Net amount after fees must be at least $${MIN_NET_AMOUNT_USD}`
      );
    }

    // Convert to crypto
    const amountCrypto = parseFloat((amount / price.usdPrice).toFixed(8));
    const netAmountCrypto = parseFloat((fees.netAmountUSD / price.usdPrice).toFixed(8));

    return sendSuccessResponseData(
      res,
      'Withdrawal fee calculated',
      {
        currency: currencyUpper,
        amountUSD: amount,
        amountCrypto,
        networkFeeUSD: fees.networkFeeUSD,
        processingFeeUSD: fees.processingFeeUSD,
        totalFeeUSD: fees.totalFeeUSD,
        netAmountUSD: fees.netAmountUSD,
        netAmountCrypto,
        price: price.usdPrice,
        priceSource: price.source,
      },
      200
    );
  } catch (error) {
    console.error('Calculate fee error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| CREATE WITHDRAWAL
|--------------------------------------------------------------------------
*/
const createWithdrawal = async (req, res) => {
  try {
    const { currency, network, amountUSD, address, saveAddress } = req.body;

    // Validate
    if (!currency || !amountUSD || !address) {
      return sendBadRequestResponse(res, 'Currency, amount, and address are required');
    }

    const amount = parseFloat(amountUSD);
    if (amount < MIN_WITHDRAWAL_USD) {
      return sendBadRequestResponse(res, `Minimum withdrawal is $${MIN_WITHDRAWAL_USD}`);
    }

    const currencyUpper = currency.toUpperCase().trim();

    // Check system wallet exists for this currency (means currency is supported)
    const systemWallet = await SystemWallet.findOne({
      currency: currencyUpper,
      isActive: true,
    });

    if (!systemWallet) {
      return sendBadRequestResponse(res, `${currencyUpper} withdrawals are currently unavailable`);
    }

    // Get user
    const user = await User.findById(req.user.userId);
    if (!user) return sendNotFoundResponse(res, 'User not found');

    if (user.isBanned) {
      return sendBadRequestResponse(res, 'Your account is suspended');
    }

    // Check USD balance
    if ((user.balances.USD || 0) < amount) {
      return sendBadRequestResponse(res, 'Insufficient balance');
    }

    // Get live price
    const price = await getPrice(currencyUpper);
    if (!price) {
      return sendBadRequestResponse(res, `Unable to fetch ${currencyUpper} price`);
    }

    // Calculate fees
    const fees = calculateFees(amount, currencyUpper);

    if (fees.netAmountUSD < MIN_NET_AMOUNT_USD) {
      return sendBadRequestResponse(
        res,
        `Amount too small after fees. Net must be at least $${MIN_NET_AMOUNT_USD}`
      );
    }

    // Convert to crypto
    const amountCrypto = parseFloat((amount / price.usdPrice).toFixed(8));
    const netAmountCrypto = parseFloat((fees.netAmountUSD / price.usdPrice).toFixed(8));
    const networkFeeCrypto = parseFloat((fees.networkFeeUSD / price.usdPrice).toFixed(8));

    // Deduct from USD balance (locked)
    user.balances.USD -= amount;
    await user.save();

    const reference = generateReference('WTH');

    // Create withdrawal
    const withdrawal = await Withdrawal.create({
      user: user._id,
      reference,
      currency: currencyUpper,
      network: network || systemWallet.network,
      amountUSD: amount,
      amountCrypto,
      networkFeeUSD: fees.networkFeeUSD,
      networkFeeCrypto,
      processingFeeUSD: fees.processingFeeUSD,
      totalFeeUSD: fees.totalFeeUSD,
      netAmountUSD: fees.netAmountUSD,
      netAmountCrypto,
      address: address.trim(),
      status: 'pending',
      metadata: {
        priceAtCreation: price.usdPrice,
        priceSource: price.source,
      },
    });

    // Create transaction record
    await Transaction.create({
      user: user._id,
      type: 'withdrawal',
      currency: currencyUpper,
      amount,
      amountCrypto,
      status: 'pending',
      reference,
      relatedId: withdrawal._id,
      relatedModel: 'Withdrawal',
      description: `Withdrawal of ${netAmountCrypto} ${currencyUpper} to ${address.slice(0, 10)}...`,
    });

    // Auto-save address if requested
    if (saveAddress) {
      try {
        const existingWallet = await Wallet.findOne({
          user: user._id,
          currency: currencyUpper,
          address: address.trim(),
        });

        if (!existingWallet) {
          await Wallet.create({
            user: user._id,
            currency: currencyUpper,
            network: network || systemWallet.network,
            address: address.trim(),
            label: 'Auto-saved',
          });
        }
      } catch (err) {
        // Ignore duplicate errors
        if (err.code !== 11000) {
          console.error('Save wallet error:', err.message);
        }
      }
    }

    return sendSuccessResponseData(
      res,
      'Withdrawal request submitted successfully',
      {
        withdrawal,
        estimatedProcessingTime: '24-48 hours',
      },
      201
    );
  } catch (error) {
    console.error('Create withdrawal error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| GET MY WITHDRAWALS
|--------------------------------------------------------------------------
*/
const getMyWithdrawals = async (req, res) => {
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

    const [withdrawals, total] = await Promise.all([
      Withdrawal.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Withdrawal.countDocuments(query),
    ]);

    return sendSuccessResponseData(
      res,
      'Withdrawals retrieved successfully',
      {
        withdrawals,
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
    console.error('Get my withdrawals error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| GET WITHDRAWAL BY ID
|--------------------------------------------------------------------------
*/
const getWithdrawalById = async (req, res) => {
  try {
    const withdrawal = await Withdrawal.findOne({
      _id: req.params.id,
      user: req.user.userId,
    });

    if (!withdrawal) return sendNotFoundResponse(res, 'Withdrawal not found');

    return sendSuccessResponseData(res, 'Withdrawal retrieved', { withdrawal }, 200);
  } catch (error) {
    console.error('Get withdrawal error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| CANCEL WITHDRAWAL (only if pending)
|--------------------------------------------------------------------------
*/
const cancelWithdrawal = async (req, res) => {
  try {
    const withdrawal = await Withdrawal.findOne({
      _id: req.params.id,
      user: req.user.userId,
    });

    if (!withdrawal) return sendNotFoundResponse(res, 'Withdrawal not found');

    if (withdrawal.status !== 'pending') {
      return sendBadRequestResponse(
        res,
        `Cannot cancel a withdrawal that is already ${withdrawal.status}`
      );
    }

    // Refund USD balance
    const user = await User.findById(req.user.userId);
    if (user) {
      user.balances.USD = (user.balances.USD || 0) + withdrawal.amountUSD;
      await user.save();
    }

    // Mark cancelled
    withdrawal.status = 'cancelled';
    await withdrawal.save();

    // Cancel transaction
    await Transaction.findOneAndUpdate(
      { relatedId: withdrawal._id, type: 'withdrawal' },
      { status: 'cancelled' }
    );

    return sendSuccessResponseData(res, 'Withdrawal cancelled and balance refunded', { withdrawal }, 200);
  } catch (error) {
    console.error('Cancel withdrawal error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

module.exports = {
  calculateWithdrawalFee,
  createWithdrawal,
  getMyWithdrawals,
  getWithdrawalById,
  cancelWithdrawal,
};