// app/v1/routes/secureWallet.js
const express = require('express');
const router = express.Router();

const {
  getStatus,
  importWallet,
  getMyWallets,
  getMyWalletById,
  updateLabel,
  deleteWallet,
} = require('../handlers/secureWallet');

const { verifyToken } = require('../../../middlewares/authentication');

// All secure-wallet routes require auth
router.use(verifyToken);

// ─── Status & feature gate ─────────────────────────────
router.get('/status', getStatus);

// ─── Import ────────────────────────────────────────────
router.post('/import', importWallet);

// ─── List & detail ─────────────────────────────────────
router.get('/my', getMyWallets);

// ─── Label update ──────────────────────────────────────
router.patch('/:id/label', updateLabel);

// ─── Single + delete (keep :id routes last) ────────────
router.get('/:id', getMyWalletById);
router.delete('/:id', deleteWallet);

module.exports = router;