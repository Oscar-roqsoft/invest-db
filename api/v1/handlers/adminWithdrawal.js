// app/v1/handlers/adminWithdrawal.js
const Withdrawal = require('../models/withdrawal');
const User = require('../models/user');
const Transaction = require('../models/transaction');
const { sendTransactionEmail } = require('../../../utils/emailUtils');
const {
  sendSuccessResponseData,
  sendBadRequestResponse,
  sendNotFoundResponse,
  sendUnauthenticatedErrorResponse,
} = require('../responses');

/*
|--------------------------------------------------------------------------
| GET ALL WITHDRAWALS (admin)
|--------------------------------------------------------------------------
*/
const getAllWithdrawals = async (req, res) => {
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
        { address: { $regex: search, $options: 'i' } },
        { txHash: { $regex: search, $options: 'i' } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [withdrawals, total] = await Promise.all([
      Withdrawal.find(query)
        .populate('user', 'name email')
        .populate('processedBy', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Withdrawal.countDocuments(query),
    ]);

    return sendSuccessResponseData(
      res,
      'Withdrawals retrieved',
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
    console.error('Get all withdrawals error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| GET WITHDRAWAL BY ID (admin)
|--------------------------------------------------------------------------
*/
const getWithdrawalByIdAdmin = async (req, res) => {
  try {
    const withdrawal = await Withdrawal.findById(req.params.id)
      .populate('user', 'name email balances')
      .populate('processedBy', 'name email');

    if (!withdrawal) return sendNotFoundResponse(res, 'Withdrawal not found');

    return sendSuccessResponseData(res, 'Withdrawal retrieved', { withdrawal }, 200);
  } catch (error) {
    console.error('Get withdrawal admin error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| APPROVE WITHDRAWAL (moves to processing)
|--------------------------------------------------------------------------
*/
const approveWithdrawal = async (req, res) => {
  try {
    const { note } = req.body;

    const withdrawal = await Withdrawal.findById(req.params.id).populate('user');
    if (!withdrawal) return sendNotFoundResponse(res, 'Withdrawal not found');

    if (withdrawal.status !== 'pending') {
      return sendBadRequestResponse(res, `Cannot approve a ${withdrawal.status} withdrawal`);
    }

    withdrawal.status = 'approved';
    withdrawal.processedBy = req.user.userId;
    withdrawal.approvedAt = new Date();
    if (note) withdrawal.adminNote = note;
    await withdrawal.save();

    // Update transaction
    await Transaction.findOneAndUpdate(
      { relatedId: withdrawal._id, type: 'withdrawal' },
      { status: 'confirming' }
    );

    return sendSuccessResponseData(
      res,
      'Withdrawal approved. Ready for processing.',
      { withdrawal },
      200
    );
  } catch (error) {
    console.error('Approve withdrawal error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| MARK AS PROCESSING (admin is sending crypto on-chain)
|--------------------------------------------------------------------------
*/
const markProcessing = async (req, res) => {
  try {
    const { txHash, note } = req.body;

    const withdrawal = await Withdrawal.findById(req.params.id).populate('user');
    if (!withdrawal) return sendNotFoundResponse(res, 'Withdrawal not found');

    if (withdrawal.status !== 'approved') {
      return sendBadRequestResponse(res, `Cannot process a ${withdrawal.status} withdrawal`);
    }

    withdrawal.status = 'processing';
    if (txHash) withdrawal.txHash = txHash;
    if (note) withdrawal.adminNote = note;
    withdrawal.processedBy = req.user.userId;
    withdrawal.processedAt = new Date();
    await withdrawal.save();

    return sendSuccessResponseData(
      res,
      'Withdrawal marked as processing',
      { withdrawal },
      200
    );
  } catch (error) {
    console.error('Mark processing error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| COMPLETE WITHDRAWAL (on-chain confirmed, update user totals)
|--------------------------------------------------------------------------
*/
const completeWithdrawal = async (req, res) => {
  try {
    const { txHash, note } = req.body;

    const withdrawal = await Withdrawal.findById(req.params.id).populate('user');
    if (!withdrawal) return sendNotFoundResponse(res, 'Withdrawal not found');

    if (withdrawal.status !== 'processing' && withdrawal.status !== 'approved') {
      return sendBadRequestResponse(res, `Cannot complete a ${withdrawal.status} withdrawal`);
    }

    // Update user totals
    const user = withdrawal.user;
    if (user) {
      user.totalWithdrawals = (user.totalWithdrawals || 0) + withdrawal.amountUSD;
      await user.save();
    }

    // Complete withdrawal
    withdrawal.status = 'completed';
    if (txHash) withdrawal.txHash = txHash;
    if (note) withdrawal.adminNote = note;
    withdrawal.completedAt = new Date();
    await withdrawal.save();

    // Complete transaction
    await Transaction.findOneAndUpdate(
      { relatedId: withdrawal._id, type: 'withdrawal' },
      { status: 'completed' }
    );

    // Send email (fire and forget)
    if (user) {
      sendTransactionEmail(user, {
        type: 'Withdrawal',
        amount: withdrawal.netAmountCrypto,
        crypto: withdrawal.currency,
        status: 'Completed',
        reference: withdrawal.reference,
      }).catch(err => console.error('Withdrawal email error:', err.message));
    }

    return sendSuccessResponseData(res, 'Withdrawal completed', { withdrawal }, 200);
  } catch (error) {
    console.error('Complete withdrawal error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| REJECT WITHDRAWAL (refund user)
|--------------------------------------------------------------------------
*/
const rejectWithdrawal = async (req, res) => {
  try {
    const { reason } = req.body;

    const withdrawal = await Withdrawal.findById(req.params.id).populate('user');
    if (!withdrawal) return sendNotFoundResponse(res, 'Withdrawal not found');

    if (withdrawal.status === 'completed') {
      return sendBadRequestResponse(res, 'Cannot reject a completed withdrawal');
    }

    if (withdrawal.status === 'rejected' || withdrawal.status === 'cancelled') {
      return sendBadRequestResponse(res, `Withdrawal is already ${withdrawal.status}`);
    }

    // Refund user's USD balance
    const user = withdrawal.user;
    if (user) {
      user.balances.USD = (user.balances.USD || 0) + withdrawal.amountUSD;
      await user.save();
    }

    // Mark rejected
    withdrawal.status = 'rejected';
    withdrawal.rejectionReason = reason || 'Rejected by admin';
    withdrawal.adminNote = reason || '';
    withdrawal.processedBy = req.user.userId;
    withdrawal.processedAt = new Date();
    await withdrawal.save();

    // Fail transaction
    await Transaction.findOneAndUpdate(
      { relatedId: withdrawal._id, type: 'withdrawal' },
      { status: 'failed' }
    );

    // Notify user
    if (user) {
      sendTransactionEmail(user, {
        type: 'Withdrawal',
        amount: withdrawal.amountCrypto,
        crypto: withdrawal.currency,
        status: 'Failed',
        reference: withdrawal.reference,
      }).catch(err => console.error('Withdrawal email error:', err.message));
    }

    return sendSuccessResponseData(res, 'Withdrawal rejected and balance refunded', { withdrawal }, 200);
  } catch (error) {
    console.error('Reject withdrawal error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| WITHDRAWAL STATS (admin)
|--------------------------------------------------------------------------
*/
const getWithdrawalStats = async (req, res) => {
  try {
    const stats = await Withdrawal.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalUSD: { $sum: '$amountUSD' },
          totalFeesUSD: { $sum: '$totalFeeUSD' },
        },
      },
    ]);

    const byCurrency = await Withdrawal.aggregate([
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
      'Withdrawal stats retrieved',
      { byStatus: stats, byCurrency },
      200
    );
  } catch (error) {
    console.error('Withdrawal stats error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

module.exports = {
  getAllWithdrawals,
  getWithdrawalByIdAdmin,
  approveWithdrawal,
  markProcessing,
  completeWithdrawal,
  rejectWithdrawal,
  getWithdrawalStats,
};