// routes/auth.js
const express = require('express');
const router = express.Router();

const {
  register,
  login,
  refreshToken,
  logout,
  verifyOTP,
  resendOTP,
  forgotPassword,
  resetPassword,
  updatePassword,
  getCurrentUser,
  getAllUsers,
} = require('../handlers/auth');

const { verifyToken, adminAuth } = require('../../../middlewares/authentication');

// Admin
router.route('/users').get(verifyToken, adminAuth, getAllUsers);

// Public
router.route('/register').post(register);
router.route('/login').post(login);
router.route('/refresh-token').post(refreshToken);
router.route('/verify-otp').post(verifyOTP);
router.route('/resend-otp').post(resendOTP);
router.route('/forgot-password').post(forgotPassword);
router.route('/reset-password').post(resetPassword);

// Protected
router.route('/logout').post(verifyToken, logout);
router.route('/update-password').post(verifyToken, updatePassword);
router.route('/me').get(verifyToken, getCurrentUser);

module.exports = router;