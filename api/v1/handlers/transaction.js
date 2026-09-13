// app/v1/handlers/transaction.js
const mongoose = require('mongoose');
const Transaction = require('../models/transaction');
const {
  sendSuccessResponseData,
  sendNotFoundResponse,
  sendUnauthenticatedErrorResponse,
} = require('../responses');

/*
|--------------------------------------------------------------------------
| GET MY TRANSACTIONS
|--------------------------------------------------------------------------
| Query params:
|   type        - deposit | withdrawal | investment | earning | referral | refund | bonus | all
|   direction   - credit | debit | all
|   status      - pending | confirming | completed | failed | cancelled | all
|   currency    - BTC | ETH | ... | USD | all
|   from        - ISO date
|   to          - ISO date
|   search      - searches reference + description
|   minAmount   - minimum USD
|   maxAmount   - maximum USD
|   page, limit - pagination
|   sort        - 'newest' (default) | 'oldest' | 'amount_high' | 'amount_low'
|--------------------------------------------------------------------------
*/
const getMyTransactions = async (req, res) => {
  try {
    const {
      type,
      direction,
      status,
      currency,
      from,
      to,
      search,
      minAmount,
      maxAmount,
      page = 1,
      limit = 20,
      sort = 'newest',
    } = req.query;

    const query = { user: req.user.userId };

    if (type && type !== 'all') query.type = type;
    if (direction && direction !== 'all') query.direction = direction;
    if (status && status !== 'all') query.status = status;
    if (currency && currency !== 'all') query.currency = currency.toUpperCase();

    if (from || to) {
      query.createdAt = {};
      if (from) query.createdAt.$gte = new Date(from);
      if (to) query.createdAt.$lte = new Date(to);
    }

    if (minAmount || maxAmount) {
      query.amount = {};
      if (minAmount) query.amount.$gte = parseFloat(minAmount);
      if (maxAmount) query.amount.$lte = parseFloat(maxAmount);
    }

    if (search) {
      query.$or = [
        { reference: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
      ];
    }

    // Sorting
    const sortMap = {
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      amount_high: { amount: -1 },
      amount_low: { amount: 1 },
    };
    const sortQuery = sortMap[sort] || sortMap.newest;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [transactions, total] = await Promise.all([
      Transaction.find(query)
        .sort(sortQuery)
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Transaction.countDocuments(query),
    ]);

    return sendSuccessResponseData(
      res,
      'Transactions retrieved successfully',
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
    console.error('Get my transactions error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| GET TRANSACTION BY ID
|--------------------------------------------------------------------------
*/
const getTransactionById = async (req, res) => {
  try {
    const transaction = await Transaction.findOne({
      _id: req.params.id,
      user: req.user.userId,
    });

    if (!transaction) return sendNotFoundResponse(res, 'Transaction not found');

    return sendSuccessResponseData(res, 'Transaction retrieved', { transaction }, 200);
  } catch (error) {
    console.error('Get transaction error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| GET TRANSACTION STATS
|--------------------------------------------------------------------------
*/
const getTransactionStats = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.userId);

    const [totals, byType, byCurrency] = await Promise.all([
      // Overall totals
      Transaction.aggregate([
        { $match: { user: userId, status: 'completed' } },
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
            totalRefunds: {
              $sum: { $cond: [{ $eq: ['$type', 'refund'] }, '$amount', 0] },
            },
            totalBonuses: {
              $sum: { $cond: [{ $eq: ['$type', 'bonus'] }, '$amount', 0] },
            },
            transactionCount: { $sum: 1 },
          },
        },
      ]),

      // Counts by type
      Transaction.aggregate([
        { $match: { user: userId } },
        { $group: { _id: '$type', count: { $sum: 1 } } },
      ]),

      // By currency
      Transaction.aggregate([
        { $match: { user: userId, status: 'completed' } },
        {
          $group: {
            _id: '$currency',
            count: { $sum: 1 },
            totalAmount: { $sum: '$amount' },
          },
        },
        { $sort: { totalAmount: -1 } },
      ]),
    ]);

    const result = totals[0] || {
      totalCredits: 0,
      totalDebits: 0,
      totalDeposits: 0,
      totalWithdrawals: 0,
      totalInvestments: 0,
      totalEarnings: 0,
      totalReferrals: 0,
      totalRefunds: 0,
      totalBonuses: 0,
      transactionCount: 0,
    };

    return sendSuccessResponseData(
      res,
      'Transaction stats retrieved',
      {
        totals: result,
        netBalance: result.totalCredits - result.totalDebits,
        countsByType: byType,
        byCurrency,
      },
      200
    );
  } catch (error) {
    console.error('Get transaction stats error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| GET MONTHLY SUMMARY (chart data)
|--------------------------------------------------------------------------
| Returns monthly totals for the last N months.
|--------------------------------------------------------------------------
*/
const getMonthlySummary = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.userId);
    const months = parseInt(req.query.months) || 6;

    const from = new Date();
    from.setMonth(from.getMonth() - months + 1);
    from.setDate(1);
    from.setHours(0, 0, 0, 0);

    const data = await Transaction.aggregate([
      {
        $match: {
          user: userId,
          status: 'completed',
          createdAt: { $gte: from },
        },
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
          },
          credits: {
            $sum: { $cond: [{ $eq: ['$direction', 'credit'] }, '$amount', 0] },
          },
          debits: {
            $sum: { $cond: [{ $eq: ['$direction', 'debit'] }, '$amount', 0] },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]);

    // Format for chart
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const formatted = data.map((d) => ({
      month: `${monthNames[d._id.month - 1]} ${d._id.year}`,
      year: d._id.year,
      monthNum: d._id.month,
      credits: parseFloat(d.credits.toFixed(2)),
      debits: parseFloat(d.debits.toFixed(2)),
      net: parseFloat((d.credits - d.debits).toFixed(2)),
      count: d.count,
    }));

    return sendSuccessResponseData(res, 'Monthly summary retrieved', { summary: formatted }, 200);
  } catch (error) {
    console.error('Get monthly summary error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| GET RECENT ACTIVITY (last N transactions)
|--------------------------------------------------------------------------
*/
const getRecentActivity = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 5;

    const transactions = await Transaction.find({
      user: req.user.userId,
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return sendSuccessResponseData(res, 'Recent activity retrieved', { transactions }, 200);
  } catch (error) {
    console.error('Get recent activity error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

module.exports = {
  getMyTransactions,
  getTransactionById,
  getTransactionStats,
  getMonthlySummary,
  getRecentActivity,
};