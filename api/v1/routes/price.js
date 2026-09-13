// app/v1/routes/price.js
const express = require('express');
const router = express.Router();

const {
  getAllPricesHandler,
  getPriceHandler,
  convertHandler,
} = require('../handlers/price');

const { optionalAuth } = require('../../../middlewares/authentication');

router.get('/', optionalAuth, getAllPricesHandler);
router.get('/:symbol', optionalAuth, getPriceHandler);
router.post('/convert', optionalAuth, convertHandler);

module.exports = router;