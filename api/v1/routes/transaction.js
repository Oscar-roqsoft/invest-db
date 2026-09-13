// app/v1/routes/transaction.js
const express = require('express');
const router = express.Router();

const {
  getMyTransactions,
  getTransactionById,
  getTransactionStats,
  getMonthlySummary,
  getRecentActivity,
} = require('../handlers/transaction');

const { verifyToken } = require('../../../middlewares/authentication');

router.get('/my', verifyToken, getMyTransactions);
router.get('/stats', verifyToken, getTransactionStats);
router.get('/monthly-summary', verifyToken, getMonthlySummary);
router.get('/recent', verifyToken, getRecentActivity);
router.get('/:id', verifyToken, getTransactionById);

module.exports = router;