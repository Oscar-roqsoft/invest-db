const express = require('express');
const router = express.Router();

const {
    getAllSystemWallets,
    getSystemWalletById,
    createSystemWallet,
    updateSystemWallet,
    toggleSystemWallet,
    deleteSystemWallet,
    seedDefaultWallets,
  } = require('../handlers/adminWallet');

  const {
    getAllDeposits,
    getDepositByIdAdmin,
    approveDeposit,
    rejectDeposit,
    getDepositStats,
  } = require('../handlers/adminDeposit');


  const {
    getAllWithdrawals,
    getWithdrawalByIdAdmin,
    approveWithdrawal,
    markProcessing,
    completeWithdrawal,
    rejectWithdrawal,
    getWithdrawalStats,
  } = require('../handlers/adminWithdrawal');

  const {
    getAllPlansAdmin,
    createPlan,
    updatePlan,
    togglePlan,
    deletePlan,
    seedDefaultPlans,
    getAllInvestmentsAdmin,
    getInvestmentStatsAdmin,
    manualRunPayouts,
    getInvestmentEarnings,
  } = require('../handlers/adminInvestment');
  const {
    getAllTransactions,
    getPlatformTransactionStats,
    getUserTransactionsAdmin,
    getDailyVolume,
  } = require('../handlers/adminTransaction');

  const {
    getAllReferrals,
    getReferralStatsAdmin,
    getUserReferralsAdmin,
    manuallyCreditReferral,
    backfillReferrals,
  } = require('../handlers/adminReferral');
  
  
  const { verifyToken } = require('../../../middlewares/authentication');


// ─── Deposits ─────────────────────────────────────────────
router.get('/deposits', getAllDeposits);
router.get('/deposits/stats', getDepositStats);
router.get('/deposits/:id', getDepositByIdAdmin);
router.post('/deposits/:id/approve', approveDeposit);
router.post('/deposits/:id/reject', rejectDeposit);
  
  // ─── System Wallets (deposit addresses) ───────────────────
  router.get('/system-wallets', getAllSystemWallets);
  router.get('/system-wallets/:id', getSystemWalletById);
  router.post('/system-wallets', createSystemWallet);
  router.put('/system-wallets/:id', updateSystemWallet);
  router.patch('/system-wallets/:id/toggle', toggleSystemWallet);
  router.delete('/system-wallets/:id', deleteSystemWallet);
  router.post('/system-wallets/seed-defaults', seedDefaultWallets);

// ─── Withdrawals ──────────────────────────────────────────
router.get('/withdrawals', getAllWithdrawals);
router.get('/withdrawals/stats', getWithdrawalStats);
router.get('/withdrawals/:id', getWithdrawalByIdAdmin);
router.post('/withdrawals/:id/approve', approveWithdrawal);
router.post('/withdrawals/:id/process', markProcessing);
router.post('/withdrawals/:id/complete', completeWithdrawal);
router.post('/withdrawals/:id/reject', rejectWithdrawal);

// ─── Investment Plans ─────────────────────────────────────
router.get('/plans', getAllPlansAdmin);
router.post('/plans', createPlan);
router.put('/plans/:id', updatePlan);
router.patch('/plans/:id/toggle', togglePlan);
router.delete('/plans/:id', deletePlan);
router.post('/plans/seed-defaults', seedDefaultPlans);

// ─── Investments ──────────────────────────────────────────
router.get('/investments', getAllInvestmentsAdmin);
router.get('/investments/stats', getInvestmentStatsAdmin);
router.get('/investments/:id/earnings', getInvestmentEarnings);
router.post('/investments/run-payouts', manualRunPayouts);


router.get('/transactions', getAllTransactions);
router.get('/transactions/stats', getPlatformTransactionStats);
router.get('/transactions/daily-volume', getDailyVolume);
router.get('/transactions/user/:userId', getUserTransactionsAdmin);

// ─── Referrals ────────────────────────────────────────────
router.get('/referrals', getAllReferrals);
router.get('/referrals/stats', getReferralStatsAdmin);
router.get('/referrals/user/:userId', getUserReferralsAdmin);
router.post('/referrals/manual-credit', manuallyCreditReferral);
router.post('/referrals/backfill', backfillReferrals);

  module.exports = router;