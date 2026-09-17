// utils/cardGenerator.js

/**
 * Generate a Luhn-valid card number with a given prefix.
 * Gold  → Visa-style prefix 4xxx
 * Black → Mastercard-style prefix 5xxx
 */
const generateCardNumber = (tier) => { /* Luhn check digit */ };

/** 3-digit CVV */
const generateCVV = () => '000 ... 999'  // via crypto.randomInt

/** Expiry = N years from now */
const generateExpiry = (years = 3) => ({ month, year });

/** Cardholder name formatting: "john doe" → "JOHN DOE" */
const formatCardholderName = (name) => { /* uppercase, trim, max 26 chars */ };

module.exports = {
  generateCardNumber,
  generateCVV,
  generateExpiry,
  formatCardholderName,
};