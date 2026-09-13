// app/v1/handlers/adminReferral.js
const mongoose = require('mongoose');
const User = require('../models/user');
const Referral = require('../models/referral');
const Deposit = require('../models/deposit');
const {
  sendSuccessResponseData,
  sendBadRequestResponse,
  sendNotFoundResponse,
  sendUnauthenticatedErrorResponse,
} = require('../responses');
const { createTransaction } = require('../../../utils/transactionHelper');
const { generateReference } = require('../../../utils/authUtils');

const REFERRAL_COMMISSION_RATE = 0.05;

/*
|--------------------------------------------------------------------------
| GET ALL REFERRALS (admin)
|--------------------------------------------------------------------------
*/
const getAllReferrals = async (req, res) => {
  try {
    const {
      status,
      search,
      referrerId,
      referredId,
      page = 1,
      limit = 30,
      sort = 'newest',
    } = req.query;

    const query = {};
    if (status && status !== 'all') query.status = status;
    if (referrerId) query.referrer = referrerId;
    if (referredId) query.referred = referredId;

    const sortMap = {
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      amount_high: { amount: -1 },
      amount_low: { amount: 1 },
    };

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [referrals, total] = await Promise.all([
      Referral.find(query)
        .populate('referrer', 'name email referralCode')
        .populate('referred', 'name email')
        .populate('deposit', 'reference amountUSD currency')
        .sort(sortMap[sort] || sortMap.newest)
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Referral.countDocuments(query),
    ]);

    return sendSuccessResponseData(
      res,
      'Referrals retrieved',
      {
        referrals,
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
    console.error('Get all referrals error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| GET REFERRAL STATS (admin, platform-wide)
|--------------------------------------------------------------------------
*/
const getReferralStatsAdmin = async (req, res) => {
  try {
    const [totalReferrals, totalReferred, byStatus, topReferrers, totalsAgg] = await Promise.all([
      Referral.countDocuments(),

      // Distinct referred users
      Referral.distinct('referred').then((ids) => ids.length),

      // Counts by status
      Referral.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 }, totalAmount: { $sum: '$amount' } } },
      ]),

      // Top 10 referrers
      Referral.aggregate([
        { $match: { status: 'credited' } },
        {
          $group: {
            _id: '$referrer',
            totalEarnings: { $sum: '$amount' },
            totalReferrals: { $addToSet: '$referred' },
          },
        },
        {
          $project: {
            totalEarnings: 1,
            totalReferrals: { $size: '$totalReferrals' },
          },
        },
        { $sort: { totalEarnings: -1 } },
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
            referralCode: '$user.referralCode',
            totalEarnings: { $round: ['$totalEarnings', 2] },
            totalReferrals: 1,
          },
        },
      ]),

      // Total commission paid
      Referral.aggregate([
        { $match: { status: 'credited' } },
        {
          $group: {
            _id: null,
            totalCommission: { $sum: '$amount' },
            totalSourceVolume: { $sum: '$sourceAmount' },
          },
        },
      ]),
    ]);

    const totals = totalsAgg[0] || { totalCommission: 0, totalSourceVolume: 0 };

    return sendSuccessResponseData(
      res,
      'Referral stats retrieved',
      {
        totalReferralRecords: totalReferrals,
        totalReferredUsers: totalReferred,
        totalCommissionPaid: parseFloat(totals.totalCommission.toFixed(2)),
        totalSourceVolume: parseFloat(totals.totalSourceVolume.toFixed(2)),
        byStatus,
        topReferrers,
      },
      200
    );
  } catch (error) {
    console.error('Referral stats admin error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| GET REFERRALS BY USER (admin)
|--------------------------------------------------------------------------
*/
const getUserReferralsAdmin = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId).select('name email referralCode referralEarnings');
    if (!user) return sendNotFoundResponse(res, 'User not found');

    const referrals = await Referral.find({ referrer: userId })
      .populate('referred', 'name email totalDeposits isVerified')
      .sort({ createdAt: -1 })
      .lean();

    const totalEarnings = referrals
      .filter((r) => r.status === 'credited')
      .reduce((sum, r) => sum + r.amount, 0);

    return sendSuccessResponseData(
      res,
      'User referrals retrieved',
      {
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          referralCode: user.referralCode,
        },
        totalReferrals: referrals.length,
        totalEarnings: parseFloat(totalEarnings.toFixed(2)),
        referrals,
      },
      200
    );
  } catch (error) {
    console.error('User referrals admin error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| MANUAL CREDIT REFERRAL (admin — in case auto-credit failed)
|--------------------------------------------------------------------------
*/
const manuallyCreditReferral = async (req, res) => {
  try {
    const { referrerId, referredId, depositId } = req.body;

    if (!referrerId || !referredId || !depositId) {
      return sendBadRequestResponse(res, 'referrerId, referredId, depositId are required');
    }

    // Get the deposit
    const deposit = await Deposit.findById(depositId);
    if (!deposit) return sendNotFoundResponse(res, 'Deposit not found');

    if (deposit.status !== 'completed') {
      return sendBadRequestResponse(res, 'Can only credit for completed deposits');
    }

    // Check for duplicate
    const existing = await Referral.findOne({
      referrer: referrerId,
      deposit: depositId,
    });

    if (existing) {
      return sendBadRequestResponse(res, 'Referral commission already credited for this deposit');
    }

    const referrer = await User.findById(referrerId);
    const referred = await User.findById(referredId);

    if (!referrer) return sendNotFoundResponse(res, 'Referrer not found');
    if (!referred) return sendNotFoundResponse(res, 'Referred user not found');

    const commission = deposit.amountUSD * REFERRAL_COMMISSION_RATE;

    // Credit referrer
    referrer.balances.USD = (referrer.balances.USD || 0) + commission;
    referrer.referralEarnings = (referrer.referralEarnings || 0) + commission;
    await referrer.save();

    // Create referral record
    const referral = await Referral.create({
      referrer: referrer._id,
      referred: referred._id,
      deposit: deposit._id,
      amount: parseFloat(commission.toFixed(2)),
      sourceAmount: deposit.amountUSD,
      rate: REFERRAL_COMMISSION_RATE,
      status: 'credited',
      referredSnapshot: {
        name: referred.name,
        email: referred.email,
      },
    });

    // Create transaction
    await createTransaction({
      user: referrer._id,
      type: 'referral',
      currency: 'USD',
      amount: parseFloat(commission.toFixed(2)),
      status: 'completed',
      reference: generateReference('REF'),
      relatedId: deposit._id,
      relatedModel: 'Deposit',
      description: `Manual referral commission from ${referred.name}`,
      balanceAfter: referrer.balances.USD,
    });

    return sendSuccessResponseData(res, 'Referral commission credited', { referral }, 201);
  } catch (error) {
    console.error('Manual credit error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| BACKFILL MISSING REFERRALS (admin)
|--------------------------------------------------------------------------
| Scans completed deposits where the user was referred but no commission
| record exists. Creates them retroactively.
|--------------------------------------------------------------------------
*/
const backfillReferrals = async (req, res) => {
  try {
    // Find users who were referred
    const referredUsers = await User.find({
      referredBy: { $ne: null },
      totalDeposits: { $gt: 0 },
    }).select('_id referredBy name email');

    let created = 0;
    let skipped = 0;
    let totalCommission = 0;

    for (const user of referredUsers) {
      // Find completed deposits for this user
      const deposits = await Deposit.find({
        user: user._id,
        status: 'completed',
      });

      for (const deposit of deposits) {
        // Check if referral already exists
        const existing = await Referral.findOne({
          referrer: user.referredBy,
          deposit: deposit._id,
        });

        if (existing) {
          skipped++;
          continue;
        }

        const commission = deposit.amountUSD * REFERRAL_COMMISSION_RATE;
        const referrer = await User.findById(user.referredBy);

        if (!referrer) {
          skipped++;
          continue;
        }

        // Create referral record
        await Referral.create({
          referrer: referrer._id,
          referred: user._id,
          deposit: deposit._id,
          amount: parseFloat(commission.toFixed(2)),
          sourceAmount: deposit.amountUSD,
          rate: REFERRAL_COMMISSION_RATE,
          status: 'credited',
          referredSnapshot: {
            name: user.name,
            email: user.email,
          },
        });

        // Credit referrer
        referrer.balances.USD = (referrer.balances.USD || 0) + commission;
        referrer.referralEarnings = (referrer.referralEarnings || 0) + commission;
        await referrer.save();

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
          description: `Backfilled referral commission from ${user.name}`,
          balanceAfter: referrer.balances.USD,
        });

        created++;
        totalCommission += commission;
      }
    }

    return sendSuccessResponseData(
      res,
      'Backfill complete',
      {
        created,
        skipped,
        totalCommission: parseFloat(totalCommission.toFixed(2)),
      },
      200
    );
  } catch (error) {
    console.error('Backfill error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

module.exports = {
  getAllReferrals,
  getReferralStatsAdmin,
  getUserReferralsAdmin,
  manuallyCreditReferral,
  backfillReferrals,
};