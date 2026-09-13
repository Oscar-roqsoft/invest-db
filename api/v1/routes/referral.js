// app/v1/routes/referral.js
const express = require('express');
const router = express.Router();

const {
  getReferralInfo,
  getMyReferrals,
  getReferralStats,
  getReferralEarnings,
  getReferralTree,
  getReferralLeaderboard,
  getMonthlyEarnings,
  validateReferralCode,
} = require('../handlers/referral');

const { verifyToken } = require('../../../middlewares/authentication');

// Public: validate referral code
router.get('/validate/:code', validateReferralCode);

// Public: view leaderboard
router.get('/leaderboard', getReferralLeaderboard);

// Protected
router.get('/info', verifyToken, getReferralInfo);
router.get('/my', verifyToken, getMyReferrals);
router.get('/stats', verifyToken, getReferralStats);
router.get('/earnings', verifyToken, getReferralEarnings);
router.get('/tree', verifyToken, getReferralTree);
router.get('/monthly-earnings', verifyToken, getMonthlyEarnings);

module.exports = router;