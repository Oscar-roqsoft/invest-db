// app/v1/handlers/adminTransaction.js
const mongoose = require('mongoose');
const Transaction = require('../models/transaction');
const {
  sendSuccessResponseData,
  sendUnauthenticatedErrorResponse,
} = require('../responses');

/*
|--------------------------------------------------------------------------
| GET ALL TRANSACTIONS (admin)
|--------------------------------------------------------------------------
*/
const getAllTransactions = async (req, res) => {
  try {
    const {
      type,
      direction,
      status,
      currency,
      userId,
      search,
      from,
      to,
      page = 1,
      limit = 30,
      sort = 'newest',
    } = req.query;

    const query = {};

    if (type && type !== 'all') query.type = type;
    if (direction && direction !== 'all') query.direction = direction;
    if (status && status !== 'all') query.status = status;
    if (currency && currency !== 'all') query.currency = currency.toUpperCase();
    if (userId) query.user = userId;

    if (from || to) {
      query.createdAt = {};
      if (from) query.createdAt.$gte = new Date(from);
      if (to) query.createdAt.$lte = new Date(to);
    }

    if (search) {
      query.$or = [
        { reference: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
      ];
    }

    const sortMap = {
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      amount_high: { amount: -1 },
      amount_low: { amount: 1 },
    };

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [transactions, total] = await Promise.all([
      Transaction.find(query)
        .populate('user', 'name email')
        .sort(sortMap[sort] || sortMap.newest)
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Transaction.countDocuments(query),
    ]);

    return sendSuccessResponseData(
      res,
      'Transactions retrieved',
      {
        transactions,
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
    console.error('Get all transactions error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| GET PLATFORM TRANSACTION STATS (admin)
|--------------------------------------------------------------------------
*/
const getPlatformTransactionStats = async (req, res) => {
  try {
    const { from, to } = req.query;

    const matchStage = { status: 'completed' };
    if (from || to) {
      matchStage.createdAt = {};
      if (from) matchStage.createdAt.$gte = new Date(from);
      if (to) matchStage.createdAt.$lte = new Date(to);
    }

    const [totals, byType, byCurrency, topUsers] = await Promise.all([
      // Overall totals
      Transaction.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: null,
            totalCredits: {
              $sum: { $cond: [{ $eq: ['$direction', 'credit'] }, '$amount', 0] },
            },
            totalDebits: {
              $sum: { $cond: [{ $eq: ['$direction', 'debit'] }, '$amount', 0] },
            },
            totalDeposits: {
              $sum: { $cond: [{ $eq: ['$type', 'deposit'] }, '$amount', 0] },
            },
            totalWithdrawals: {
              $sum: { $cond: [{ $eq: ['$type', 'withdrawal'] }, '$amount', 0] },
            },
            totalInvestments: {
              $sum: { $cond: [{ $eq: ['$type', 'investment'] }, '$amount', 0] },
            },
            totalEarnings: {
              $sum: { $cond: [{ $eq: ['$type', 'earning'] }, '$amount', 0] },
            },
            totalReferrals: {
              $sum: { $cond: [{ $eq: ['$type', 'referral'] }, '$amount', 0] },
            },
            transactionCount: { $sum: 1 },
          },
        },
      ]),

      // By type
      Transaction.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: '$type',
            count: { $sum: 1 },
            totalAmount: { $sum: '$amount' },
          },
        },
      ]),

      // By currency
      Transaction.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: '$currency',
            count: { $sum: 1 },
            totalAmount: { $sum: '$amount' },
          },
        },
        { $sort: { totalAmount: -1 } },
      ]),

      // Top 10 users by transaction volume
      Transaction.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: '$user',
            totalAmount: { $sum: '$amount' },
            count: { $sum: 1 },
          },
        },
        { $sort: { totalAmount: -1 } },
        { $limit: 10 },
        {
          $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: '_id',
            as: 'user',
          },
        },
        { $unwind: '$user' },
        {
          $project: {
            name: '$user.name',
            email: '$user.email',
            totalAmount: 1,
            count: 1,
          },
        },
      ]),
    ]);

    return sendSuccessResponseData(
      res,
      'Platform stats retrieved',
      {
        totals: totals[0] || {},
        byType,
        byCurrency,
        topUsers,
      },
      200
    );
  } catch (error) {
    console.error('Platform stats error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| GET USER TRANSACTIONS (admin)
|--------------------------------------------------------------------------
*/
const getUserTransactionsAdmin = async (req, res) => {
  try {
    const { userId } = req.params;
    const { type, status, page = 1, limit = 20 } = req.query;

    const query = { user: userId };
    if (type && type !== 'all') query.type = type;
    if (status && status !== 'all') query.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [transactions, total] = await Promise.all([
      Transaction.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Transaction.countDocuments(query),
    ]);

    return sendSuccessResponseData(
      res,
      'User transactions retrieved',
      {
        transactions,
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
    console.error('Get user transactions error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| GET DAILY VOLUME (for charts)
|--------------------------------------------------------------------------
*/
const getDailyVolume = async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;

    const from = new Date();
    from.setDate(from.getDate() - days);
    from.setHours(0, 0, 0, 0);

    const data = await Transaction.aggregate([
      {
        $match: {
          status: 'completed',
          createdAt: { $gte: from },
        },
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
            day: { $dayOfMonth: '$createdAt' },
          },
          deposits: {
            $sum: { $cond: [{ $eq: ['$type', 'deposit'] }, '$amount', 0] },
          },
          withdrawals: {
            $sum: { $cond: [{ $eq: ['$type', 'withdrawal'] }, '$amount', 0] },
          },
          investments: {
            $sum: { $cond: [{ $eq: ['$type', 'investment'] }, '$amount', 0] },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } },
    ]);

    const formatted = data.map((d) => ({
      date: `${d._id.year}-${String(d._id.month).padStart(2, '0')}-${String(d._id.day).padStart(2, '0')}`,
      deposits: parseFloat(d.deposits.toFixed(2)),
      withdrawals: parseFloat(d.withdrawals.toFixed(2)),
      investments: parseFloat(d.investments.toFixed(2)),
      count: d.count,
    }));

    return sendSuccessResponseData(res, 'Daily volume retrieved', { volume: formatted }, 200);
  } catch (error) {
    console.error('Get daily volume error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

module.exports = {
  getAllTransactions,
  getPlatformTransactionStats,
  getUserTransactionsAdmin,
  getDailyVolume,
};