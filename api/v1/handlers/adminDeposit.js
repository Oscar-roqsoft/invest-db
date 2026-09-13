// app/v1/handlers/adminDeposit.js
const Deposit = require('../models/deposit');
const User = require('../models/user');
const Transaction = require('../models/transaction');
const Referral = require('../models/referral');
const { sendTransactionEmail } = require('../../../utils/emailUtils');
const {
  sendSuccessResponseData,
  sendBadRequestResponse,
  sendNotFoundResponse,
  sendUnauthenticatedErrorResponse,
} = require('../responses');

const REFERRAL_COMMISSION_RATE = 0.05; // 5%

/*
|--------------------------------------------------------------------------
| GET ALL DEPOSITS (admin)
|--------------------------------------------------------------------------
*/
const getAllDeposits = async (req, res) => {
  try {
    const {
      status,
      currency,
      search,
      page = 1,
      limit = 20,
    } = req.query;

    const query = {};
    if (status && status !== 'all') query.status = status;
    if (currency && currency !== 'all') query.currency = currency.toUpperCase();

    if (search) {
      query.$or = [
        { reference: { $regex: search, $options: 'i' } },
        { txHash: { $regex: search, $options: 'i' } },
        { address: { $regex: search, $options: 'i' } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [deposits, total] = await Promise.all([
      Deposit.find(query)
        .populate('user', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Deposit.countDocuments(query),
    ]);

    return sendSuccessResponseData(
      res,
      'Deposits retrieved',
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
    console.error('Get all deposits error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| GET DEPOSIT BY ID (admin)
|--------------------------------------------------------------------------
*/
const getDepositByIdAdmin = async (req, res) => {
  try {
    const deposit = await Deposit.findById(req.params.id).populate('user', 'name email');

    if (!deposit) return sendNotFoundResponse(res, 'Deposit not found');

    return sendSuccessResponseData(res, 'Deposit retrieved', { deposit }, 200);
  } catch (error) {
    console.error('Get deposit admin error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| APPROVE / COMPLETE DEPOSIT
|--------------------------------------------------------------------------
*/
const approveDeposit = async (req, res) => {
  try {
    const { note } = req.body;

    const deposit = await Deposit.findById(req.params.id).populate('user');
    if (!deposit) return sendNotFoundResponse(res, 'Deposit not found');

    if (deposit.status === 'completed') {
      return sendBadRequestResponse(res, 'Deposit already completed');
    }

    if (deposit.status === 'failed' || deposit.status === 'expired') {
      return sendBadRequestResponse(res, `Cannot approve a ${deposit.status} deposit`);
    }

    const user = deposit.user;

    // Credit user's balance
    user.balances.USD = (user.balances.USD || 0) + deposit.amountUSD;
    user.balances[deposit.currency] = (user.balances[deposit.currency] || 0) + deposit.amountCrypto;
    user.totalDeposits = (user.totalDeposits || 0) + deposit.amountUSD;
    await user.save();

    // Mark deposit completed
    deposit.status = 'completed';
    deposit.confirmedAt = new Date();
    deposit.creditedAt = new Date();
    if (note) deposit.note = note;
    await deposit.save();

    // Update transaction
    await Transaction.findOneAndUpdate(
      { relatedId: deposit._id, type: 'deposit' },
      { status: 'completed' }
    );

    // ─── REFERRAL COMMISSION ─────────────────────────────
   
        // After crediting the user, in the referral block:
        if (user.referredBy) {
            const referrer = await User.findById(user.referredBy);
            if (referrer) {
                const commission = deposit.amountUSD * 0.05;
        
                // Credit referrer
                referrer.balances.USD = (referrer.balances.USD || 0) + commission;
                referrer.referralEarnings = (referrer.referralEarnings || 0) + commission;
                await referrer.save();
        
                // Create referral record with snapshot
                await Referral.create({
                referrer: referrer._id,
                referred: user._id,
                deposit: deposit._id,
                amount: parseFloat(commission.toFixed(2)),
                sourceAmount: deposit.amountUSD,
                rate: 0.05,
                status: 'credited',
                referredSnapshot: {
                    name: user.name,
                    email: user.email,
                },
                });
        
                // Transaction
                await createTransaction({
                user: referrer._id,
                type: 'referral',
                currency: 'USD',
                amount: parseFloat(commission.toFixed(2)),
                status: 'completed',
                reference: generateReference('REF'),
                relatedId: deposit._id,
                relatedModel: 'Deposit',
                description: `Referral commission from ${user.name}`,
                balanceAfter: referrer.balances.USD,
                });
            }
        
        }

    // Send email notification (fire and forget)
    sendTransactionEmail(user, {
      type: 'Deposit',
      amount: deposit.amountCrypto,
      crypto: deposit.currency,
      status: 'Completed',
      reference: deposit.reference,
    }).catch(err => console.error('Deposit email error:', err.message));

    return sendSuccessResponseData(res, 'Deposit approved and credited', { deposit }, 200);
  } catch (error) {
    console.error('Approve deposit error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| REJECT DEPOSIT
|--------------------------------------------------------------------------
*/
const rejectDeposit = async (req, res) => {
  try {
    const { reason } = req.body;

    const deposit = await Deposit.findById(req.params.id).populate('user');
    if (!deposit) return sendNotFoundResponse(res, 'Deposit not found');

    if (deposit.status === 'completed') {
      return sendBadRequestResponse(res, 'Cannot reject a completed deposit');
    }

    deposit.status = 'failed';
    deposit.note = reason || 'Rejected by admin';
    await deposit.save();

    await Transaction.findOneAndUpdate(
      { relatedId: deposit._id, type: 'deposit' },
      { status: 'failed' }
    );

    // Notify user
    sendTransactionEmail(deposit.user, {
      type: 'Deposit',
      amount: deposit.amountCrypto,
      crypto: deposit.currency,
      status: 'Failed',
      reference: deposit.reference,
    }).catch(err => console.error('Deposit email error:', err.message));

    return sendSuccessResponseData(res, 'Deposit rejected', { deposit }, 200);
  } catch (error) {
    console.error('Reject deposit error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| DEPOSIT STATS (admin)
|--------------------------------------------------------------------------
*/
const getDepositStats = async (req, res) => {
  try {
    const stats = await Deposit.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalUSD: { $sum: '$amountUSD' },
        },
      },
    ]);

    const byCurrency = await Deposit.aggregate([
      { $match: { status: 'completed' } },
      {
        $group: {
          _id: '$currency',
          count: { $sum: 1 },
          totalUSD: { $sum: '$amountUSD' },
        },
      },
      { $sort: { totalUSD: -1 } },
    ]);

    return sendSuccessResponseData(
      res,
      'Deposit stats retrieved',
      { byStatus: stats, byCurrency },
      200
    );
  } catch (error) {
    console.error('Deposit stats error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

module.exports = {
  getAllDeposits,
  getDepositByIdAdmin,
  approveDeposit,
  rejectDeposit,
  getDepositStats,
};