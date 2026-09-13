// app/v1/handlers/price.js
const {
    getAllPrices,
    getPrice,
    usdToCrypto,
    cryptoToUsd,
  } = require('../../../utils/priceService');
  const {
    sendSuccessResponseData,
    sendBadRequestResponse,
    sendNotFoundResponse,
    sendUnauthenticatedErrorResponse,
  } = require('../responses');
  
  /*
  |--------------------------------------------------------------------------
  | GET ALL PRICES
  |--------------------------------------------------------------------------
  */
  const getAllPricesHandler = async (req, res) => {
    try {
      const prices = await getAllPrices();
      return sendSuccessResponseData(
        res,
        'Crypto prices retrieved',
        { prices: Object.values(prices) },
        200
      );
    } catch (error) {
      console.error('Get all prices error:', error);
      return sendUnauthenticatedErrorResponse(res, error.message);
    }
  };
  
  /*
  |--------------------------------------------------------------------------
  | GET PRICE BY SYMBOL
  |--------------------------------------------------------------------------
  */
  const getPriceHandler = async (req, res) => {
    try {
      const price = await getPrice(req.params.symbol);
  
      if (!price) {
        return sendNotFoundResponse(res, `Price for ${req.params.symbol} not found`);
      }
  
      return sendSuccessResponseData(res, 'Price retrieved', { price }, 200);
    } catch (error) {
      console.error('Get price error:', error);
      return sendUnauthenticatedErrorResponse(res, error.message);
    }
  };
  
  /*
  |--------------------------------------------------------------------------
  | CONVERT (USD ↔ CRYPTO)
  |--------------------------------------------------------------------------
  | Body:
  |   { from: 'USD' | 'BTC', to: 'BTC' | 'USD', amount: 100 }
  |--------------------------------------------------------------------------
  */
  const convertHandler = async (req, res) => {
    try {
      const { from, to, amount } = req.body;
  
      if (!from || !to || !amount) {
        return sendBadRequestResponse(res, 'from, to, and amount are required');
      }
  
      if (amount <= 0) {
        return sendBadRequestResponse(res, 'Amount must be greater than 0');
      }
  
      const fromUpper = from.toUpperCase();
      const toUpper = to.toUpperCase();
  
      if (fromUpper === toUpper) {
        return sendSuccessResponseData(
          res,
          'Conversion not needed',
          { from: fromUpper, to: toUpper, amount, result: amount },
          200
        );
      }
  
      // USD → CRYPTO
      if (fromUpper === 'USD') {
        const result = await usdToCrypto(amount, toUpper);
        return sendSuccessResponseData(res, 'Conversion successful', { conversion: result }, 200);
      }
  
      // CRYPTO → USD
      if (toUpper === 'USD') {
        const result = await cryptoToUsd(amount, fromUpper);
        return sendSuccessResponseData(res, 'Conversion successful', { conversion: result }, 200);
      }
  
      return sendBadRequestResponse(res, 'Only USD ↔ crypto conversions are supported');
    } catch (error) {
      console.error('Convert error:', error);
      return sendBadRequestResponse(res, error.message);
    }
  };
  
  module.exports = {
    getAllPricesHandler,
    getPriceHandler,
    convertHandler,
  };