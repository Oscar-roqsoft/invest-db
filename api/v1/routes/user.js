// app/v1/routes/user.js
const express = require('express');
const router = express.Router();

const {
  getMyProfile,
  updateProfile,
  updateAvatar,
  changePassword,
  setPin,
  changePin,
  toggle2FA,
  submitKYC,
  getSecurityOverview,
  deleteAccount,
} = require('../handlers/user');

const { verifyToken } = require('../../../middlewares/authentication');

// Profile
router.get('/profile', verifyToken, getMyProfile);
router.put('/profile', verifyToken, updateProfile);
router.put('/avatar', verifyToken, updateAvatar);

// Security
router.get('/security', verifyToken, getSecurityOverview);
router.post('/change-password', verifyToken, changePassword);
router.post('/set-pin', verifyToken, setPin);
router.post('/change-pin', verifyToken, changePin);
router.post('/toggle-2fa', verifyToken, toggle2FA);

// KYC
router.post('/kyc', verifyToken, submitKYC);

// Danger zone
router.delete('/account', verifyToken, deleteAccount);

module.exports = router;