// app/v1/routes/investment.js
const express = require('express');
const router = express.Router();

const {
  getPlans,
  getPlanBySlug,
  previewInvestment,
  createInvestment,
  getMyInvestments,
  getActiveInvestments,
  getInvestmentById,
  getInvestmentStats,
} = require('../handlers/investment');

const { verifyToken } = require('../../../middlewares/authentication');

// Public: view plans
router.get('/plans',  getPlans);
router.get('/plans/:slug', getPlanBySlug);

// Protected: investments
router.post('/preview', verifyToken, previewInvestment);
router.post('/create', verifyToken, createInvestment);
router.get('/my', verifyToken, getMyInvestments);
router.get('/active', verifyToken, getActiveInvestments);
router.get('/stats', verifyToken, getInvestmentStats);
router.get('/:id', verifyToken, getInvestmentById);

module.exports = router;