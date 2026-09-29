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


// Static routes BEFORE :id
router.get('/eligibility',verifyToken, getEligibility);
router.get('/my',verifyToken, getMyCards);
router.post('/generate',verifyToken, generateCard);

// By-id routes
router.get('/:id', verifyToken,getCardById);
router.post('/:id/freeze',verifyToken, freezeCard);
router.delete('/:id',verifyToken, deleteCard);

module.exports = router;