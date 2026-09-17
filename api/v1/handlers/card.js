// app/v1/handlers/card.js
const crypto = require('crypto');
const mongoose = require('mongoose');
const Card = require('../models/card');
const User = require('../models/user');
const {
  sendSuccessResponseData,
  sendBadRequestResponse,
  sendNotFoundResponse,
  sendUnauthenticatedErrorResponse,
} = require('../responses');

// ─────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────
const MIN_BALANCE_USD = 5000;
const CARD_VALIDITY_YEARS = 3;

// ─────────────────────────────────────────────────────────────
// HELPERS — Luhn & generators
// ─────────────────────────────────────────────────────────────

/** Luhn check digit for a numeric string */
const computeLuhnCheckDigit = (partial) => {
  let sum = 0;
  let double = true; // next digit from the right is doubled
  for (let i = partial.length - 1; i >= 0; i--) {
    let d = Number(partial[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return (10 - (sum % 10)) % 10;
};

/** Generate a full Luhn-valid 16-digit number with a given prefix digit */
const generateFullCardNumber = (prefixDigit) => {
  // 15 digits total before adding the check digit
  let body = String(prefixDigit);
  for (let i = 0; i < 14; i++) {
    body += crypto.randomInt(0, 10);
  }
  const checkDigit = computeLuhnCheckDigit(body);
  return body + String(checkDigit);
};

/** 3-digit CVV using crypto.randomInt */
const generateCvv = () =>
  String(crypto.randomInt(0, 1000)).padStart(3, '0');

/** Expiry: 3 years from now, same month */
const generateExpiry = (years = CARD_VALIDITY_YEARS) => {
  const now = new Date();
  const month = now.getMonth() + 1;        // 1-12
  const year = now.getFullYear() + years;
  // Last millisecond of the month at 23:59:59
  const expiresAt = new Date(year, month, 0, 23, 59, 59, 999);
  return { month, year, expiresAt };
};

/** Uppercase, collapse spaces, truncate to 26 chars */
const formatCardholderName = (rawName) => {
  const cleaned = String(rawName || 'CARD HOLDER')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
  return cleaned.slice(0, 26);
};

/** Mask helper */
const mask = (fullNumber) => `•••• •••• •••• ${fullNumber.slice(-4)}`;

// ─────────────────────────────────────────────────────────────
// Generate a full Card doc payload (does NOT save)
// ─────────────────────────────────────────────────────────────
const buildCardPayload = ({ user, tier, generatedBy, createdByAdmin }) => {
  const prefix = tier === 'black' ? '5' : '4';
  const fullNumber = generateFullCardNumber(prefix);
  const cvv = generateCvv();
  const { month, year, expiresAt } = generateExpiry();

  return {
    user: user._id,
    fullNumber,
    cardNumber: mask(fullNumber),
    last4: fullNumber.slice(-4),
    cvv,
    expiryMonth: month,
    expiryYear: year,
    cardholderName: formatCardholderName(user.name),
    tier,
    status: 'active',
    currency: 'USD',
    generatedBy,
    createdByAdmin: !!createdByAdmin,
    issuedAt: new Date(),
    expiresAt,
  };
};

// Retry-safe create — on the off chance of a duplicate card number
const createCardWithRetry = async (payload, tries = 5) => {
  for (let i = 0; i < tries; i++) {
    try {
      return await Card.create(payload);
    } catch (err) {
      // Duplicate key on fullNumber → regenerate and try again
      if (err?.code === 11000 && err?.keyPattern?.fullNumber) {
        const prefix = payload.tier === 'black' ? '5' : '4';
        payload.fullNumber = generateFullCardNumber(prefix);
        payload.cardNumber = mask(payload.fullNumber);
        payload.last4 = payload.fullNumber.slice(-4);
        continue;
      }
      throw err;
    }
  }
  throw new Error('Failed to generate a unique card number');
};

// ─────────────────────────────────────────────────────────────
// PUBLIC / PRIVATE SHAPES
// ─────────────────────────────────────────────────────────────
/** Full shape — includes fullNumber + cvv. Send only to owner or admin. */
const fullCardShape = (card) => ({
  _id: card._id,
  user: card.user,
  fullNumber: card.fullNumber,
  cardNumber: card.cardNumber,
  last4: card.last4,
  cvv: card.cvv,
  expiryMonth: card.expiryMonth,
  expiryYear: card.expiryYear,
  expiryDisplay: `${String(card.expiryMonth).padStart(2, '0')}/${String(card.expiryYear).slice(-2)}`,
  cardholderName: card.cardholderName,
  tier: card.tier,
  status: card.status,
  currency: card.currency,
  generatedBy: card.generatedBy,
  createdByAdmin: card.createdByAdmin,
  issuedAt: card.issuedAt,
  expiresAt: card.expiresAt,
  frozenAt: card.frozenAt,
  cancelledAt: card.cancelledAt,
  createdAt: card.createdAt,
});

/** List shape — hides fullNumber and cvv for safety. */
const listCardShape = (card) => ({
  _id: card._id,
  cardNumber: card.cardNumber,
  last4: card.last4,
  expiryMonth: card.expiryMonth,
  expiryYear: card.expiryYear,
  expiryDisplay: `${String(card.expiryMonth).padStart(2, '0')}/${String(card.expiryYear).slice(-2)}`,
  cardholderName: card.cardholderName,
  tier: card.tier,
  status: card.status,
  currency: card.currency,
  issuedAt: card.issuedAt,
  expiresAt: card.expiresAt,
  frozenAt: card.frozenAt,
  createdAt: card.createdAt,
});

// ═════════════════════════════════════════════════════════════
// GET /card/eligibility
// ═════════════════════════════════════════════════════════════
const getEligibility = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) return sendNotFoundResponse(res, 'User not found');

    if (user.isBanned) {
      return sendSuccessResponseData(res, 'Not eligible', {
        eligible: false,
        reason: 'Your account is suspended',
        balanceUSD: user.balances?.USD || 0,
        requiredUSD: MIN_BALANCE_USD,
        tiers: { gold: false, black: false },
      });
    }

    const balance = Number(user.balances?.USD || 0);
    const meetsBalance = balance >= MIN_BALANCE_USD;

    const existing = await Card.find({
      user: user._id,
      status: { $in: ['active', 'frozen', 'expired'] },
    }).select('tier');

    const takenTiers = new Set(existing.map((c) => c.tier));

    const tiers = {
      gold: meetsBalance && !takenTiers.has('gold'),
      black: meetsBalance && !takenTiers.has('black'),
    };

    const eligible = tiers.gold || tiers.black;

    let reason = null;
    if (!meetsBalance) {
      reason = `You need at least $${MIN_BALANCE_USD.toLocaleString()} available balance to generate a card`;
    } else if (!eligible) {
      reason = 'You already have a card for every tier';
    }

    return sendSuccessResponseData(res, 'Eligibility retrieved', {
      eligible,
      reason,
      balanceUSD: balance,
      requiredUSD: MIN_BALANCE_USD,
      tiers,
    });
  } catch (error) {
    console.error('Card eligibility error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

// ═════════════════════════════════════════════════════════════
// GET /card/my
// ═════════════════════════════════════════════════════════════
const getMyCards = async (req, res) => {
  try {
    const cards = await Card.find({
      user: req.user.userId,
      status: { $ne: 'cancelled' }, // hide cancelled by default
    })
      .sort({ issuedAt: -1 })
      .lean();

    return sendSuccessResponseData(res, 'Cards retrieved', {
      cards: cards.map(listCardShape),
      total: cards.length,
    });
  } catch (error) {
    console.error('Get my cards error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

// ═════════════════════════════════════════════════════════════
// POST /card/generate
// ═════════════════════════════════════════════════════════════
const generateCard = async (req, res) => {
  try {
    const { tier } = req.body;

    if (!tier || !['gold', 'black'].includes(String(tier).toLowerCase())) {
      return sendBadRequestResponse(res, 'tier must be "gold" or "black"');
    }

    const tierNorm = String(tier).toLowerCase();

    const user = await User.findById(req.user.userId);
    if (!user) return sendNotFoundResponse(res, 'User not found');
    if (user.isBanned) return sendBadRequestResponse(res, 'Your account is suspended');

    // Balance gate
    const balance = Number(user.balances?.USD || 0);
    if (balance < MIN_BALANCE_USD) {
      return sendBadRequestResponse(
        res,
        `You need at least $${MIN_BALANCE_USD.toLocaleString()} available balance to generate a card`
      );
    }

    // One per tier check (partial index also enforces this at the DB level)
    const existing = await Card.findOne({
      user: user._id,
      tier: tierNorm,
      status: { $in: ['active', 'frozen', 'expired'] },
    });

    if (existing) {
      return sendBadRequestResponse(
        res,
        `You already have a ${tierNorm} card`
      );
    }

    const payload = buildCardPayload({
      user,
      tier: tierNorm,
      generatedBy: req.user.userId,
      createdByAdmin: false,
    });

    const card = await createCardWithRetry(payload);

    return sendSuccessResponseData(
      res,
      'Card generated successfully',
      { card: fullCardShape(card) },
      201
    );
  } catch (error) {
    console.error('Generate card error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

// ═════════════════════════════════════════════════════════════
// GET /card/:id
// ═════════════════════════════════════════════════════════════
const getCardById = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return sendNotFoundResponse(res, 'Card not found');
    }

    const card = await Card.findOne({
      _id: req.params.id,
      user: req.user.userId,
    });

    if (!card) return sendNotFoundResponse(res, 'Card not found');
    if (card.status === 'cancelled') {
      return sendNotFoundResponse(res, 'Card not found');
    }

    return sendSuccessResponseData(res, 'Card retrieved', {
      card: fullCardShape(card),
    });
  } catch (error) {
    console.error('Get card error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

// ═════════════════════════════════════════════════════════════
// POST /card/:id/freeze
// Toggle: active <-> frozen. No-op for expired/cancelled.
// ═════════════════════════════════════════════════════════════
const freezeCard = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return sendNotFoundResponse(res, 'Card not found');
    }

    const card = await Card.findOne({
      _id: req.params.id,
      user: req.user.userId,
    });

    if (!card) return sendNotFoundResponse(res, 'Card not found');

    if (card.status === 'cancelled') {
      return sendBadRequestResponse(res, 'Card is cancelled');
    }
    if (card.status === 'expired') {
      return sendBadRequestResponse(res, 'Card has expired');
    }

    if (card.status === 'active') {
      card.status = 'frozen';
      card.frozenAt = new Date();
    } else if (card.status === 'frozen') {
      card.status = 'active';
      card.frozenAt = undefined;
    }

    await card.save();

    return sendSuccessResponseData(
      res,
      `Card ${card.status === 'frozen' ? 'frozen' : 'unfrozen'}`,
      { card: fullCardShape(card) }
    );
  } catch (error) {
    console.error('Freeze card error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

// ═════════════════════════════════════════════════════════════
// DELETE /card/:id (soft delete → status: 'cancelled')
// ═════════════════════════════════════════════════════════════
const deleteCard = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return sendNotFoundResponse(res, 'Card not found');
    }

    const card = await Card.findOne({
      _id: req.params.id,
      user: req.user.userId,
    });

    if (!card) return sendNotFoundResponse(res, 'Card not found');
    if (card.status === 'cancelled') {
      return sendBadRequestResponse(res, 'Card is already cancelled');
    }

    card.status = 'cancelled';
    card.cancelledAt = new Date();
    await card.save();

    return sendSuccessResponseData(res, 'Card cancelled', {
      card: listCardShape(card),
    });
  } catch (error) {
    console.error('Delete card error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

module.exports = {
  getEligibility,
  getMyCards,
  generateCard,
  getCardById,
  freezeCard,
  deleteCard,
};