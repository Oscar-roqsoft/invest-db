// app/v1/handlers/investment.js
const mongoose = require('mongoose');
const User = require('../models/user');
const Investment = require('../models/investment');
const InvestmentPlan = require('../models/investmentPlan');
const Transaction = require('../models/transaction');
const { generateReference } = require('../../../utils/authUtils');
const {
  sendSuccessResponseData,
  sendBadRequestResponse,
  sendNotFoundResponse,
  sendUnauthenticatedErrorResponse,
} = require('../responses');

/*
|--------------------------------------------------------------------------
| GET ALL ACTIVE PLANS
|--------------------------------------------------------------------------
*/
const getPlans = async (req, res) => {
  try {
    const plans = await InvestmentPlan.find({ isActive: true })
      .select('-createdBy -updatedBy -__v')
      .sort({ sortOrder: 1, minAmount: 1 });

    return sendSuccessResponseData(res, 'Plans retrieved', { plans }, 200);
  } catch (error) {
    console.error('Get plans error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| GET PLAN BY SLUG
|--------------------------------------------------------------------------
*/
const getPlanBySlug = async (req, res) => {
  try {
    const plan = await InvestmentPlan.findOne({
      slug: req.params.slug.toLowerCase(),
      isActive: true,
    }).select('-createdBy -updatedBy -__v');

    if (!plan) return sendNotFoundResponse(res, 'Plan not found');

    return sendSuccessResponseData(res, 'Plan retrieved', { plan }, 200);
  } catch (error) {
    console.error('Get plan error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| PREVIEW INVESTMENT (calculate returns before buying)
|--------------------------------------------------------------------------
*/
const previewInvestment = async (req, res) => {
  try {
    const { planId, amount } = req.body;

    if (!planId || !amount) {
      return sendBadRequestResponse(res, 'Plan ID and amount are required');
    }

    const plan = await InvestmentPlan.findById(planId);
    if (!plan || !plan.isActive) {
      return sendNotFoundResponse(res, 'Plan not found or inactive');
    }

    const amt = parseFloat(amount);

    if (amt < plan.minAmount || amt > plan.maxAmount) {
      return sendBadRequestResponse(
        res,
        `Amount must be between $${plan.minAmount} and $${plan.maxAmount}`
      );
    }

    const dailyEarning = parseFloat((amt * (plan.dailyRoi / 100)).toFixed(2));
    const expectedProfit = parseFloat((dailyEarning * plan.duration).toFixed(2));
    const expectedReturn = parseFloat((amt + expectedProfit).toFixed(2));

    return sendSuccessResponseData(
      res,
      'Investment preview',
      {
        plan: {
          id: plan._id,
          name: plan.name,
          dailyRoi: plan.dailyRoi,
          duration: plan.duration,
          totalRoi: plan.dailyRoi * plan.duration,
        },
        amount: amt,
        dailyEarning,
        expectedProfit,
        expectedReturn,
      },
      200
    );
  } catch (error) {
    console.error('Preview investment error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| CREATE INVESTMENT
|--------------------------------------------------------------------------
*/
const createInvestment = async (req, res) => {
  try {
    const { planId, amount } = req.body;

    if (!planId || !amount) {
      return sendBadRequestResponse(res, 'Plan ID and amount are required');
    }

    const amt = parseFloat(amount);

    // Get plan
    const plan = await InvestmentPlan.findById(planId);
    if (!plan || !plan.isActive) {
      return sendNotFoundResponse(res, 'Plan not found or inactive');
    }

    if (amt < plan.minAmount || amt > plan.maxAmount) {
      return sendBadRequestResponse(
        res,
        `Amount must be between $${plan.minAmount} and $${plan.maxAmount}`
      );
    }

    // Get user
    const user = await User.findById(req.user.userId);
    if (!user) return sendNotFoundResponse(res, 'User not found');
    if (user.isBanned) return sendBadRequestResponse(res, 'Account suspended');

    // Check balance
    if ((user.balances.USD || 0) < amt) {
      return sendBadRequestResponse(res, 'Insufficient balance');
    }

    // Calculate returns
    const dailyEarning = parseFloat((amt * (plan.dailyRoi / 100)).toFixed(2));
    const expectedProfit = parseFloat((dailyEarning * plan.duration).toFixed(2));
    const expectedReturn = parseFloat((amt + expectedProfit).toFixed(2));

    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + plan.duration * 24 * 60 * 60 * 1000);
    const nextPayoutAt = new Date(startDate.getTime() + 24 * 60 * 60 * 1000);

    // Deduct balance
    user.balances.USD -= amt;
    user.totalInvestments = (user.totalInvestments || 0) + amt;
    await user.save();

    // Create investment
    const investment = await Investment.create({
      user: user._id,
      plan: plan._id,
      planName: plan.name,
      planSlug: plan.slug,
      amount: amt,
      dailyRoi: plan.dailyRoi,
      duration: plan.duration,
      totalRoi: plan.dailyRoi * plan.duration,
      dailyEarning,
      expectedProfit,
      expectedReturn,
      startDate,
      endDate,
      nextPayoutAt,
      status: 'active',
    });

    // Create transaction
    await Transaction.create({
      user: user._id,
      type: 'investment',
      currency: 'USD',
      amount: amt,
      amountCrypto: 0,
      status: 'completed',
      reference: generateReference('INV'),
      relatedId: investment._id,
      relatedModel: 'Investment',
      description: `Invested $${amt} in ${plan.name}`,
    });

    return sendSuccessResponseData(
      res,
      'Investment created successfully',
      { investment },
      201
    );
  } catch (error) {
    console.error('Create investment error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| GET MY INVESTMENTS
|--------------------------------------------------------------------------
*/
const getMyInvestments = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;

    const query = { user: req.user.userId };
    if (status && status !== 'all') query.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [investments, total] = await Promise.all([
      Investment.find(query)
        .populate('plan', 'name slug icon color')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Investment.countDocuments(query),
    ]);

    return sendSuccessResponseData(
      res,
      'Investments retrieved',
      {
        investments,
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
    console.error('Get my investments error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| GET MY ACTIVE INVESTMENTS
|--------------------------------------------------------------------------
*/
const getActiveInvestments = async (req, res) => {
  try {
    const investments = await Investment.find({
      user: req.user.userId,
      status: 'active',
    })
      .populate('plan', 'name slug icon color')
      .sort({ createdAt: -1 });

    return sendSuccessResponseData(res, 'Active investments retrieved', { investments }, 200);
  } catch (error) {
    console.error('Get active investments error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| GET INVESTMENT BY ID
|--------------------------------------------------------------------------
*/
const getInvestmentById = async (req, res) => {
  try {
    const investment = await Investment.findOne({
      _id: req.params.id,
      user: req.user.userId,
    }).populate('plan', 'name slug icon color');

    if (!investment) return sendNotFoundResponse(res, 'Investment not found');

    // Compute current progress
    const now = Date.now();
    const start = new Date(investment.startDate).getTime();
    const end = new Date(investment.endDate).getTime();
    const elapsed = now - start;
    const total = end - start;
    const progress = Math.min(Math.max((elapsed / total) * 100, 0), 100);
    const daysLeft = Math.max(Math.ceil((end - now) / (1000 * 60 * 60 * 24)), 0);

    return sendSuccessResponseData(
      res,
      'Investment retrieved',
      {
        investment,
        progress: parseFloat(progress.toFixed(2)),
        daysLeft,
      },
      200
    );
  } catch (error) {
    console.error('Get investment error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| GET MY INVESTMENT STATS
|--------------------------------------------------------------------------
*/
const getInvestmentStats = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.userId);

    const [totals] = await Investment.aggregate([
      { $match: { user: userId } },
      {
        $group: {
          _id: null,
          totalInvested: { $sum: '$amount' },
          totalEarned: { $sum: '$earned' },
          activeCount: {
            $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] },
          },
          completedCount: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] },
          },
          totalExpected: { $sum: '$expectedReturn' },
        },
      },
    ]);

    return sendSuccessResponseData(
      res,
      'Investment stats retrieved',
      {
        totalInvested: totals?.totalInvested || 0,
        totalEarned: totals?.totalEarned || 0,
        totalExpected: totals?.totalExpected || 0,
        activeCount: totals?.activeCount || 0,
        completedCount: totals?.completedCount || 0,
      },
      200
    );
  } catch (error) {
    console.error('Investment stats error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

module.exports = {
  getPlans,
  getPlanBySlug,
  previewInvestment,
  createInvestment,
  getMyInvestments,
  getActiveInvestments,
  getInvestmentById,
  getInvestmentStats,
};