// app/v1/routes/wallet.js
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
} = require('../handlers/wallet');

const { verifyToken } = require('../../../middlewares/authentication');

// Balances & stats
router.get('/balances', verifyToken, getBalances);
router.get('/stats', verifyToken, getWalletStats);

// Deposit addresses (admin-managed system wallets)
router.get('/addresses', verifyToken, getDepositAddresses);
router.get('/addresses/:currency', verifyToken, getDepositAddressByCurrency);

// User's saved withdrawal wallets
router.get('/saved', verifyToken, getSavedWallets);
router.post('/saved', verifyToken, addSavedWallet);
router.put('/saved/:id', verifyToken, updateSavedWallet);
router.delete('/saved/:id', verifyToken, deleteSavedWallet);

module.exports = router;