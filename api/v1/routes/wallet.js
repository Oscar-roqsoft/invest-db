const express = require('express');
const router = express.Router();

const {
  getBalances,
  getWalletStats,
  getDepositAddresses,
  getDepositAddressByCurrency,
  getSavedWallets,
  addSavedWallet,
  updateSavedWallet,
  deleteSavedWallet,
  // ⬇️ NEW
  getAllSystemWallets,
  getSystemWalletById,
} = require('../handlers/wallet');

const { verifyToken } = require('../../../middlewares/authentication');

// Balances & stats
router.get('/balances', verifyToken, getBalances);
router.get('/stats', verifyToken, getWalletStats);

// Deposit addresses (admin-managed system wallets — active only)
router.get('/addresses', verifyToken, getDepositAddresses);
router.get('/addresses/:currency', verifyToken, getDepositAddressByCurrency);

// ⬇️ NEW: System wallets (user-facing, active only, no admin metadata)
router.get('/system-wallets', verifyToken, getAllSystemWallets);
router.get('/system-wallets/:id', verifyToken, getSystemWalletById);

// User's saved withdrawal wallets
router.get('/saved', verifyToken, getSavedWallets);
router.post('/saved', verifyToken, addSavedWallet);
router.put('/saved/:id', verifyToken, updateSavedWallet);
router.delete('/saved/:id', verifyToken, deleteSavedWallet);

module.exports = router;