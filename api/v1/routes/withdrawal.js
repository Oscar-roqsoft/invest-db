
// app/v1/routes/withdrawal.js
const express = require('express');
const router = express.Router();

const {
  calculateWithdrawalFee,
  createWithdrawal,
  getMyWithdrawals,
  getWithdrawalById,
  cancelWithdrawal,
} = require('../handlers/withdrawal');

const { verifyToken } = require('../../../middlewares/authentication');

// Fee preview (before submitting)
router.post('/calculate-fee', verifyToken, calculateWithdrawalFee);

// Create & manage withdrawals
router.post('/create', verifyToken, createWithdrawal);
router.get('/my', verifyToken, getMyWithdrawals);
router.get('/:id', verifyToken, getWithdrawalById);
router.post('/:id/cancel', verifyToken, cancelWithdrawal);

module.exports = router;