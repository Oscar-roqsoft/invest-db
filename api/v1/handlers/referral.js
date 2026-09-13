// app/v1/handlers/referral.js
const mongoose = require('mongoose');
const User = require('../models/user');
const Referral = require('../models/referral');
const {
  sendSuccessResponseData,
  sendNotFoundResponse,
  sendUnauthenticatedErrorResponse,
} = require('../responses');

const REFERRAL_COMMISSION_RATE = 0.05; // 5%

/*
|--------------------------------------------------------------------------
| GET REFERRAL INFO (user's code, link, totals)
|--------------------------------------------------------------------------
*/
const getReferralInfo = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select(
      'name email referralCode referralEarnings referralCount totalDeposits'
    );

    if (!user) return sendNotFoundResponse(res, 'User not found');

    // Direct referrals count
    const directCount = await User.countDocuments({ referredBy: user._id });

    // Referrals that generated a commission (active referrals)
    const activeCount = await Referral.distinct('referred', {
      referrer: user._id,
      status: 'credited',
    }).then((ids) => ids.length);

    // Total commission earned
    const [earningsAgg] = await Referral.aggregate([
      { $match: { referrer: user._id, status: 'credited' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);

    const totalEarnings = earningsAgg?.total || 0;

    // Pending commission (if you support pending status)
    const [pendingAgg] = await Referral.aggregate([
      { $match: { referrer: user._id, status: 'pending' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);

    const pendingEarnings = pendingAgg?.total || 0;

    const appUrl = process.env.APP_URL || 'https://coinsquarewealth.org';
    const referralLink = `${appUrl}/register?ref=${user.referralCode}`;

    return sendSuccessResponseData(
      res,
      'Referral info retrieved',
      {
        referralCode: user.referralCode,
        referralLink,
        commissionRate: REFERRAL_COMMISSION_RATE * 100, // as percentage
        totalReferrals: directCount,
        activeReferrals: activeCount,
        totalEarnings: parseFloat(totalEarnings.toFixed(2)),
        pendingEarnings: parseFloat(pendingEarnings.toFixed(2)),
        availableEarnings: parseFloat(totalEarnings.toFixed(2)),
      },
      200
    );
  } catch (error) {
    console.error('Get referral info error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| GET MY REFERRALS (list of users I referred)
|--------------------------------------------------------------------------
*/
const getMyReferrals = async (req, res) => {
  try {
    const { status, search, page = 1, limit = 20, sort = 'newest' } = req.query;

    // Build user query
    const userQuery = { referredBy: req.user.userId };

    if (search) {
      userQuery.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const sortMap = {
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      name: { name: 1 },
    };

    const [users, total] = await Promise.all([
      User.find(userQuery)
        .select('name email createdAt isVerified totalDeposits')
        .sort(sortMap[sort] || sortMap.newest)
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      User.countDocuments(userQuery),
    ]);

    // Enrich each user with their commission earned
    const userIds = users.map((u) => u._id);

    const commissionMap = await Referral.aggregate([
      {
        $match: {
          referrer: new mongoose.Types.ObjectId(req.user.userId),
          referred: { $in: userIds },
          status: 'credited',
        },
      },
      {
        $group: {
          _id: '$referred',
          totalCommission: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
    ]);

    const commissionByUser = {};
    commissionMap.forEach((c) => {
      commissionByUser[c._id.toString()] = {
        totalCommission: c.totalCommission,
        commissionCount: c.count,
      };
    });

    // Status per referral
    const getStatus = (user) => {
      if (!user.isVerified) return 'pending';
      if (user.totalDeposits > 0) return 'active';
      return 'inactive';
    };

    const referrals = users.map((u) => {
      const comm = commissionByUser[u._id.toString()] || {
        totalCommission: 0,
        commissionCount: 0,
      };

      return {
        _id: u._id,
        name: u.name,
        email: u.email,
        joinedAt: u.createdAt,
        isVerified: u.isVerified,
        totalDeposits: u.totalDeposits || 0,
        commissionEarned: parseFloat(comm.totalCommission.toFixed(2)),
        commissionCount: comm.commissionCount,
        status: getStatus(u),
      };
    });

    // Apply status filter post-aggregation
    let filtered = referrals;
    if (status && status !== 'all') {
      filtered = referrals.filter((r) => r.status === status);
    }

    return sendSuccessResponseData(
      res,
      'Referrals retrieved',
      {
        referrals: filtered,
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
    console.error('Get my referrals error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| GET REFERRAL STATS
|--------------------------------------------------------------------------
*/
const getReferralStats = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.userId);

    const [directCount, verifiedCount, depositedCount, commissions] = await Promise.all([
      // Total users who used my code
      User.countDocuments({ referredBy: userId }),

      // Verified referrals
      User.countDocuments({ referredBy: userId, isVerified: true }),

      // Referrals who made at least one deposit
      User.countDocuments({ referredBy: userId, totalDeposits: { $gt: 0 } }),

      // Total commissions
      Referral.aggregate([
        { $match: { referrer: userId, status: 'credited' } },
        {
          $group: {
            _id: null,
            totalEarnings: { $sum: '$amount' },
            totalSourceVolume: { $sum: '$sourceAmount' },
            commissionCount: { $sum: 1 },
          },
        },
      ]),
    ]);

    const comm = commissions[0] || {
      totalEarnings: 0,
      totalSourceVolume: 0,
      commissionCount: 0,
    };

    // Conversion rate
    const conversionRate = directCount > 0
      ? parseFloat(((depositedCount / directCount) * 100).toFixed(2))
      : 0;

    return sendSuccessResponseData(
      res,
      'Referral stats retrieved',
      {
        totalReferrals: directCount,
        verifiedReferrals: verifiedCount,
        activeReferrals: depositedCount,
        conversionRate,
        totalEarnings: parseFloat(comm.totalEarnings.toFixed(2)),
        totalSourceVolume: parseFloat(comm.totalSourceVolume.toFixed(2)),
        commissionCount: comm.commissionCount,
        averageCommission: comm.commissionCount > 0
          ? parseFloat((comm.totalEarnings / comm.commissionCount).toFixed(2))
          : 0,
      },
      200
    );
  } catch (error) {
    console.error('Get referral stats error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| GET REFERRAL EARNINGS HISTORY
|--------------------------------------------------------------------------
*/
const getReferralEarnings = async (req, res) => {
  try {
    const { page = 1, limit = 20, from, to } = req.query;

    const query = {
      referrer: req.user.userId,
      status: 'credited',
    };

    if (from || to) {
      query.createdAt = {};
      if (from) query.createdAt.$gte = new Date(from);
      if (to) query.createdAt.$lte = new Date(to);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [earnings, total, [totalsAgg]] = await Promise.all([
      Referral.find(query)
        .populate('referred', 'name email')
        .populate('deposit', 'reference amountUSD currency')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),

      Referral.countDocuments(query),

      Referral.aggregate([
        { $match: query },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
    ]);

    return sendSuccessResponseData(
      res,
      'Referral earnings retrieved',
      {
        earnings,
        totalEarned: totalsAgg?.total || 0,
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
    console.error('Get referral earnings error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| GET MY REFERRAL TREE (multi-level structure)
|--------------------------------------------------------------------------
*/
const getReferralTree = async (req, res) => {
  try {
    // Level 1: direct referrals
    const level1Users = await User.find({ referredBy: req.user.userId })
      .select('name email createdAt isVerified totalDeposits referralCode')
      .lean();

    const level1Ids = level1Users.map((u) => u._id);

    // Level 2: referrals of referrals
    const level2Users = level1Ids.length
      ? await User.find({ referredBy: { $in: level1Ids } })
          .select('name email createdAt isVerified totalDeposits referredBy')
          .lean()
      : [];

    // Build tree
    const tree = level1Users.map((u1) => ({
      user: u1,
      level: 1,
      children: level2Users
        .filter((u2) => u2.referredBy?.toString() === u1._id.toString())
        .map((u2) => ({
          user: u2,
          level: 2,
          children: [],
        })),
    }));

    return sendSuccessResponseData(
      res,
      'Referral tree retrieved',
      {
        tree,
        totalLevel1: level1Users.length,
        totalLevel2: level2Users.length,
      },
      200
    );
  } catch (error) {
    console.error('Get referral tree error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| GET REFERRAL LEADERBOARD (top referrers)
|--------------------------------------------------------------------------
*/
const getReferralLeaderboard = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;

    const leaderboard = await Referral.aggregate([
      { $match: { status: 'credited' } },
      {
        $group: {
          _id: '$referrer',
          totalEarnings: { $sum: '$amount' },
          totalReferrals: { $addToSet: '$referred' },
          commissionCount: { $sum: 1 },
        },
      },
      {
        $project: {
          totalEarnings: 1,
          totalReferrals: { $size: '$totalReferrals' },
          commissionCount: 1,
        },
      },
      { $sort: { totalEarnings: -1 } },
      { $limit: limit },
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
          _id: 0,
          name: '$user.name',
          // Mask email for privacy
          emailMasked: {
            $concat: [
              { $substrCP: ['$user.email', 0, 3] },
              '***',
              {
                $substrCP: [
                  '$user.email',
                  { $subtract: [{ $strLenCP: '$user.email' }, 8] },
                  -1,
                ],
              },
            ],
          },
          totalEarnings: { $round: ['$totalEarnings', 2] },
          totalReferrals: 1,
        },
      },
    ]);

    return sendSuccessResponseData(res, 'Leaderboard retrieved', { leaderboard }, 200);
  } catch (error) {
    console.error('Get leaderboard error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| GET MONTHLY EARNINGS SUMMARY (chart data)
|--------------------------------------------------------------------------
*/
const getMonthlyEarnings = async (req, res) => {
  try {
    const months = parseInt(req.query.months) || 6;

    const from = new Date();
    from.setMonth(from.getMonth() - months + 1);
    from.setDate(1);
    from.setHours(0, 0, 0, 0);

    const data = await Referral.aggregate([
      {
        $match: {
          referrer: new mongoose.Types.ObjectId(req.user.userId),
          status: 'credited',
          createdAt: { $gte: from },
        },
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
          },
          total: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]);

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const summary = data.map((d) => ({
      month: `${monthNames[d._id.month - 1]} ${d._id.year}`,
      year: d._id.year,
      monthNum: d._id.month,
      earnings: parseFloat(d.total.toFixed(2)),
      count: d.count,
    }));

    return sendSuccessResponseData(res, 'Monthly earnings retrieved', { summary }, 200);
  } catch (error) {
    console.error('Get monthly earnings error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| VALIDATE REFERRAL CODE (public — used at register)
|--------------------------------------------------------------------------
*/
const validateReferralCode = async (req, res) => {
  try {
    const { code } = req.params;

    if (!code) return sendNotFoundResponse(res, 'Referral code required');

    const user = await User.findOne({
      referralCode: code.toUpperCase().trim(),
    }).select('name referralCode');

    if (!user) {
      return sendSuccessResponseData(
        res,
        'Invalid referral code',
        { valid: false },
        200
      );
    }

    return sendSuccessResponseData(
      res,
      'Referral code valid',
      {
        valid: true,
        referrerName: user.name,
      },
      200
    );
  } catch (error) {
    console.error('Validate referral code error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

module.exports = {
  getReferralInfo,
  getMyReferrals,
  getReferralStats,
  getReferralEarnings,
  getReferralTree,
  getReferralLeaderboard,
  getMonthlyEarnings,
  validateReferralCode,
};