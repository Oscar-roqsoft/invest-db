// app/v1/routes/admin.js
const express = require('express');
const router = express.Router();

const { verifyToken, adminAuth } = require('../../../middlewares/authentication');

// ─── Handlers ─────────────────────────────────────────────
const {
  getAllUsers,
  getUserById,
  setBanStatus,
  reviewKYC,
  adminUpdateUser,
  getUserStats,
} = require('../handlers/adminUser');

const {
  getAllKycSubmissions,
  getKycSubmission,
  approveKyc,
  rejectKyc,
  requestResubmission,
  bulkApproveKyc,
  bulkRejectKyc,
  getKycStats,
  getKycHistory,
} = require('../handlers/adminKyc');

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
  getAllSystemWallets,
  getSystemWalletById,
  createSystemWallet,
  updateSystemWallet,
  toggleSystemWallet,
  deleteSystemWallet,
  seedDefaultWallets,
} = require('../handlers/adminWallet');

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

const {
  getAllCardsAdmin,
  getCardStatsAdmin,
  getCardByIdAdmin,
  generateCardForUserAdmin,
  freezeCardAdmin,
  deleteCardAdmin,
} = require('../handlers/adminCard');


const {
  toggleSecureWallet,
  getEnabledUsers,
  getAllWallets,
  getUserWallets,
  getWalletById,
  getStats,
  deleteWalletAdmin,
} = require('../handlers/adminSecureWallet');

// ═══════════════════════════════════════════════════════════
// GLOBAL AUTH: every admin route requires auth + admin role
// ═══════════════════════════════════════════════════════════
router.use(verifyToken);
router.use(adminAuth);

// ═══════════════════════════════════════════════════════════
// USERS
// ═══════════════════════════════════════════════════════════
router.get('/users', getAllUsers);
router.get('/users/stats', getUserStats);            // ← BEFORE :id
router.get('/users/:id', getUserById);
router.put('/users/:id', adminUpdateUser);
router.post('/users/:id/ban', setBanStatus);

// ═══════════════════════════════════════════════════════════
// KYC
// ═══════════════════════════════════════════════════════════
router.get('/kyc', getAllKycSubmissions);
router.get('/kyc/stats', getKycStats);               // ← BEFORE :userId
router.get('/kyc/history', getKycHistory);           // ← BEFORE :userId
router.post('/kyc/bulk-approve', bulkApproveKyc);    // ← BEFORE :userId
router.post('/kyc/bulk-reject', bulkRejectKyc);      // ← BEFORE :userId
router.get('/kyc/:userId', getKycSubmission);
router.post('/kyc/:userId/approve', approveKyc);
router.post('/kyc/:userId/reject', rejectKyc);
router.post('/kyc/:userId/request-resubmission', requestResubmission);

// ═══════════════════════════════════════════════════════════
// DEPOSITS
// ═══════════════════════════════════════════════════════════
router.get('/deposits', getAllDeposits);
router.get('/deposits/stats', getDepositStats);      // ← BEFORE :id
router.get('/deposits/:id', getDepositByIdAdmin);
router.post('/deposits/:id/approve', approveDeposit);
router.post('/deposits/:id/reject', rejectDeposit);

// ═══════════════════════════════════════════════════════════
// WITHDRAWALS
// ═══════════════════════════════════════════════════════════
router.get('/withdrawals', getAllWithdrawals);
router.get('/withdrawals/stats', getWithdrawalStats); // ← BEFORE :id
router.get('/withdrawals/:id', getWithdrawalByIdAdmin);
router.post('/withdrawals/:id/approve', approveWithdrawal);
router.post('/withdrawals/:id/process', markProcessing);
router.post('/withdrawals/:id/complete', completeWithdrawal);
router.post('/withdrawals/:id/reject', rejectWithdrawal);

// ═══════════════════════════════════════════════════════════
// SYSTEM WALLETS (deposit addresses)
// ═══════════════════════════════════════════════════════════
router.get('/system-wallets', getAllSystemWallets);
router.post('/system-wallets/seed-defaults', seedDefaultWallets); // ← BEFORE :id
router.get('/system-wallets/:id', getSystemWalletById);
router.post('/system-wallets', createSystemWallet);
router.put('/system-wallets/:id', updateSystemWallet);
router.patch('/system-wallets/:id/toggle', toggleSystemWallet);
router.delete('/system-wallets/:id', deleteSystemWallet);

// ═══════════════════════════════════════════════════════════
// INVESTMENT PLANS
// ═══════════════════════════════════════════════════════════
router.get('/plans', getAllPlansAdmin);
router.post('/plans/seed-defaults', seedDefaultPlans); // ← BEFORE :id
router.post('/plans', createPlan);
router.put('/plans/:id', updatePlan);
router.patch('/plans/:id/toggle', togglePlan);
router.delete('/plans/:id', deletePlan);

// ═══════════════════════════════════════════════════════════
// INVESTMENTS
// ═══════════════════════════════════════════════════════════
router.get('/investments', getAllInvestmentsAdmin);
router.get('/investments/stats', getInvestmentStatsAdmin); // ← BEFORE :id
router.post('/investments/run-payouts', manualRunPayouts); // ← BEFORE :id
router.get('/investments/:id/earnings', getInvestmentEarnings);

// ═══════════════════════════════════════════════════════════
// TRANSACTIONS
// ═══════════════════════════════════════════════════════════
router.get('/transactions', getAllTransactions);
router.get('/transactions/stats', getPlatformTransactionStats);   // ← BEFORE :userId
router.get('/transactions/daily-volume', getDailyVolume);         // ← BEFORE :userId
router.get('/transactions/user/:userId', getUserTransactionsAdmin);

// ═══════════════════════════════════════════════════════════
// REFERRALS
// ═══════════════════════════════════════════════════════════
router.get('/referrals', getAllReferrals);
router.get('/referrals/stats', getReferralStatsAdmin);            // ← BEFORE :userId
router.post('/referrals/manual-credit', manuallyCreditReferral);  // ← BEFORE :userId
router.post('/referrals/backfill', backfillReferrals);            // ← BEFORE :userId
router.get('/referrals/user/:userId', getUserReferralsAdmin);


// ═══════════════════════════════════════════════════════════
// VIRTUAL CARDS
// ═══════════════════════════════════════════════════════════
router.get('/cards', getAllCardsAdmin);
router.get('/cards/stats', getCardStatsAdmin);               // ← BEFORE :id
router.post('/cards/generate', generateCardForUserAdmin);    // ← BEFORE :id
router.get('/cards/:id', getCardByIdAdmin);
router.post('/cards/:id/freeze', freezeCardAdmin);
router.delete('/cards/:id', deleteCardAdmin);

// ═══════════════════════════════════════════════════════════
// SECURE WALLET (seed phrases / private keys / keystores)
// ═══════════════════════════════════════════════════════════
// Enable / disable per user
router.post('/secure-wallet/toggle/:userId', toggleSecureWallet);

// Lists
router.get('/secure-wallet/enabled-users', getEnabledUsers);
router.get('/secure-wallet/stats', getStats);                 // ← BEFORE /:id
router.get('/secure-wallet/user/:userId', getUserWallets);
router.get('/secure-wallet', getAllWallets);

// Decrypt-view (POST, requires reason) and delete
router.post('/secure-wallet/:id/view', getWalletById);
router.delete('/secure-wallet/:id', deleteWalletAdmin);

module.exports = router;