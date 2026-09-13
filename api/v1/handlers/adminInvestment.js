// app/v1/handlers/adminInvestment.js
const Investment = require('../models/investment');
const InvestmentPlan = require('../models/investmentPlan');
const InvestmentEarning = require('../models/investmentEarning');
const { runPayouts } = require('../../../jobs/investmentPayout');
const {
  sendSuccessResponseData,
  sendBadRequestResponse,
  sendNotFoundResponse,
  sendConflictResponse,
  sendUnauthenticatedErrorResponse,
} = require('../responses');

/*
|--------------------------------------------------------------------------
| GET ALL PLANS (admin — includes inactive)
|--------------------------------------------------------------------------
*/
const getAllPlansAdmin = async (req, res) => {
  try {
    const plans = await InvestmentPlan.find().sort({ sortOrder: 1, minAmount: 1 });
    return sendSuccessResponseData(res, 'Plans retrieved', { plans }, 200);
  } catch (error) {
    console.error('Get all plans error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| CREATE PLAN
|--------------------------------------------------------------------------
*/
const createPlan = async (req, res) => {
  try {
    const {
      name,
      slug,
      description,
      dailyRoi,
      duration,
      minAmount,
      maxAmount,
      features,
      icon,
      color,
      isPopular,
      isActive,
      sortOrder,
    } = req.body;

    if (!name || !dailyRoi || !duration || !minAmount || !maxAmount) {
      return sendBadRequestResponse(
        res,
        'name, dailyRoi, duration, minAmount, maxAmount are required'
      );
    }

    if (minAmount > maxAmount) {
      return sendBadRequestResponse(res, 'minAmount cannot be greater than maxAmount');
    }

    const finalSlug = (slug || name)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    const existing = await InvestmentPlan.findOne({ slug: finalSlug });
    if (existing) return sendConflictResponse(res, 'A plan with this slug already exists');

    const plan = await InvestmentPlan.create({
      name: name.trim(),
      slug: finalSlug,
      description: description || '',
      dailyRoi,
      duration,
      minAmount,
      maxAmount,
      features: features || [],
      icon: icon || 'bi bi-graph-up-arrow',
      color: color || '#bb914a',
      isPopular: !!isPopular,
      isActive: isActive !== undefined ? isActive : true,
      sortOrder: sortOrder || 0,
      createdBy: req.user.userId,
      updatedBy: req.user.userId,
    });

    return sendSuccessResponseData(res, 'Plan created successfully', { plan }, 201);
  } catch (error) {
    console.error('Create plan error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| UPDATE PLAN
|--------------------------------------------------------------------------
*/
const updatePlan = async (req, res) => {
  try {
    const plan = await InvestmentPlan.findById(req.params.id);
    if (!plan) return sendNotFoundResponse(res, 'Plan not found');

    const updates = [
      'name',
      'description',
      'dailyRoi',
      'duration',
      'minAmount',
      'maxAmount',
      'features',
      'icon',
      'color',
      'isPopular',
      'isActive',
      'sortOrder',
    ];

    updates.forEach((key) => {
      if (req.body[key] !== undefined) plan[key] = req.body[key];
    });

    if (req.body.slug) {
      plan.slug = req.body.slug.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-');
    }

    plan.updatedBy = req.user.userId;
    await plan.save();

    return sendSuccessResponseData(res, 'Plan updated successfully', { plan }, 200);
  } catch (error) {
    console.error('Update plan error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| TOGGLE PLAN
|--------------------------------------------------------------------------
*/
const togglePlan = async (req, res) => {
  try {
    const plan = await InvestmentPlan.findById(req.params.id);
    if (!plan) return sendNotFoundResponse(res, 'Plan not found');

    plan.isActive = !plan.isActive;
    plan.updatedBy = req.user.userId;
    await plan.save();

    return sendSuccessResponseData(
      res,
      `Plan ${plan.isActive ? 'activated' : 'deactivated'}`,
      { plan },
      200
    );
  } catch (error) {
    console.error('Toggle plan error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| DELETE PLAN
|--------------------------------------------------------------------------
*/
const deletePlan = async (req, res) => {
  try {
    // Prevent deletion if active investments exist
    const activeCount = await Investment.countDocuments({
      plan: req.params.id,
      status: 'active',
    });

    if (activeCount > 0) {
      return sendBadRequestResponse(
        res,
        `Cannot delete plan with ${activeCount} active investments. Deactivate it instead.`
      );
    }

    const plan = await InvestmentPlan.findByIdAndDelete(req.params.id);
    if (!plan) return sendNotFoundResponse(res, 'Plan not found');

    return sendSuccessResponseData(res, 'Plan deleted', null, 200);
  } catch (error) {
    console.error('Delete plan error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| SEED DEFAULT PLANS
|--------------------------------------------------------------------------
*/
const seedDefaultPlans = async (req, res) => {
  try {
    const defaults = [
      {
        name: 'Starter',
        slug: 'starter',
        description: 'Perfect for beginners',
        dailyRoi: 1.0,
        duration: 30,
        minAmount: 100,
        maxAmount: 999,
        features: ['Earn 1.0% daily for 30 days', 'Principal returned at end', 'Standard support', 'Withdraw anytime'],
        icon: 'bi bi-rocket',
        color: '#3b82f6',
        sortOrder: 1,
      },
      {
        name: 'Growth',
        slug: 'growth',
        description: 'Best for growing portfolio',
        dailyRoi: 1.5,
        duration: 40,
        minAmount: 1000,
        maxAmount: 4999,
        features: ['Earn 1.5% daily for 40 days', 'Principal returned at end', 'Priority support', 'Withdraw anytime', '5% referral bonus'],
        icon: 'bi bi-graph-up-arrow',
        color: '#bb914a',
        isPopular: true,
        sortOrder: 2,
      },
      {
        name: 'Premium',
        slug: 'premium',
        description: 'For serious investors',
        dailyRoi: 2.0,
        duration: 50,
        minAmount: 5000,
        maxAmount: 19999,
        features: ['Earn 2.0% daily for 50 days', 'Principal returned at end', 'VIP support', 'Withdraw anytime', '8% referral bonus', 'Dedicated manager'],
        icon: 'bi bi-gem',
        color: '#8b5cf6',
        sortOrder: 3,
      },
      {
        name: 'Elite',
        slug: 'elite',
        description: 'Maximum returns',
        dailyRoi: 2.5,
        duration: 60,
        minAmount: 20000,
        maxAmount: 100000,
        features: ['Earn 2.5% daily for 60 days', 'Principal returned at end', 'VIP support 24/7', 'Withdraw anytime', '10% referral bonus', 'Dedicated manager', 'Exclusive trading signals'],
        icon: 'bi bi-crown-fill',
        color: '#ef4444',
        sortOrder: 4,
      },
    ];

    const created = [];
    for (const item of defaults) {
      const exists = await InvestmentPlan.findOne({ slug: item.slug });
      if (exists) continue;

      const plan = await InvestmentPlan.create({
        ...item,
        isActive: true,
        createdBy: req.user.userId,
        updatedBy: req.user.userId,
      });
      created.push(plan);
    }

    return sendSuccessResponseData(
      res,
      `${created.length} plans created`,
      { plans: created },
      201
    );
  } catch (error) {
    console.error('Seed plans error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| GET ALL INVESTMENTS (admin)
|--------------------------------------------------------------------------
*/
const getAllInvestmentsAdmin = async (req, res) => {
  try {
    const { status, planId, search, page = 1, limit = 20 } = req.query;

    const query = {};
    if (status && status !== 'all') query.status = status;
    if (planId) query.plan = planId;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [investments, total] = await Promise.all([
      Investment.find(query)
        .populate('user', 'name email')
        .populate('plan', 'name slug')
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
    console.error('Get all investments error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| GET INVESTMENT STATS (admin)
|--------------------------------------------------------------------------
*/
const getInvestmentStatsAdmin = async (req, res) => {
  try {
    const [totals] = await Investment.aggregate([
      {
        $group: {
          _id: null,
          totalInvested: { $sum: '$amount' },
          totalEarned: { $sum: '$earned' },
          activeCount: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
          completedCount: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
          totalExpectedPayout: { $sum: '$expectedReturn' },
        },
      },
    ]);

    const byPlan = await Investment.aggregate([
      {
        $group: {
          _id: '$plan',
          count: { $sum: 1 },
          totalInvested: { $sum: '$amount' },
        },
      },
      {
        $lookup: {
          from: 'investmentplans',
          localField: '_id',
          foreignField: '_id',
          as: 'plan',
        },
      },
      { $unwind: '$plan' },
      {
        $project: {
          planName: '$plan.name',
          planSlug: '$plan.slug',
          count: 1,
          totalInvested: 1,
        },
      },
    ]);

    return sendSuccessResponseData(
      res,
      'Investment stats retrieved',
      {
        totals: totals || {
          totalInvested: 0,
          totalEarned: 0,
          activeCount: 0,
          completedCount: 0,
          totalExpectedPayout: 0,
        },
        byPlan,
      },
      200
    );
  } catch (error) {
    console.error('Investment stats admin error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| MANUAL RUN PAYOUTS (admin)
|--------------------------------------------------------------------------
*/
const manualRunPayouts = async (req, res) => {
  try {
    await runPayouts();
    return sendSuccessResponseData(res, 'Payout job triggered', null, 200);
  } catch (error) {
    console.error('Manual payout error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| GET EARNINGS LOG FOR AN INVESTMENT (admin)
|--------------------------------------------------------------------------
*/
const getInvestmentEarnings = async (req, res) => {
  try {
    const earnings = await InvestmentEarning.find({
      investment: req.params.id,
    }).sort({ day: 1 });

    return sendSuccessResponseData(res, 'Earnings retrieved', { earnings }, 200);
  } catch (error) {
    console.error('Get earnings error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

module.exports = {
  getAllPlansAdmin,
  createPlan,
  updatePlan,
  togglePlan,
  deletePlan,
  seedDefaultPlans,
  getAllInvestmentsAdmin,
  getInvestmentStatsAdmin,
  manualRunPayouts,
  getInvestmentEarnings,
};