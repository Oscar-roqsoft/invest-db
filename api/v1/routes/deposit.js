// app/v1/routes/deposit.js
const express = require('express');
const router = express.Router();

const {
  createDeposit,
  getMyDeposits,
  getDepositById,
  submitTxHash,
  cancelDeposit,
} = require('../handlers/deposit');

const { verifyToken } = require('../../../middlewares/authentication');

router.post('/create', verifyToken, createDeposit);
router.post('/submit-tx', verifyToken, submitTxHash);
router.get('/my', verifyToken, getMyDeposits);
router.get('/:id', verifyToken, getDepositById);
router.post('/:id/cancel', verifyToken, cancelDeposit);

module.exports = router;