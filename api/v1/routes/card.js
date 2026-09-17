// app/v1/routes/card.js
const express = require('express');
const router = express.Router();

const {
  getEligibility,
  getMyCards,
  generateCard,
  getCardById,
  freezeCard,
  deleteCard,
} = require('../handlers/card');

const { verifyToken } = require('../../../middlewares/authentication');

// All card routes require auth
router.use(verifyToken);

// Static routes BEFORE :id
router.get('/eligibility', getEligibility);
router.get('/my', getMyCards);
router.post('/generate', generateCard);

// By-id routes
router.get('/:id', getCardById);
router.post('/:id/freeze', freezeCard);
router.delete('/:id', deleteCard);

module.exports = router;