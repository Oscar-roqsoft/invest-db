// app/v1/handlers/adminCard.js
const mongoose = require('mongoose');
const crypto = require('crypto');
const Card = require('../models/card');
const User = require('../models/user');
const {
  sendSuccessResponseData,
  sendBadRequestResponse,
  sendNotFoundResponse,
  sendUnauthenticatedErrorResponse,
} = require('../responses');

// ─── Reuse the same helpers as the user handler ──────────────
// (Kept in sync. If you extract these into utils/cardGenerator.js
//  later, update both imports.)
const computeLuhnCheckDigit = (partial) => {
  let sum = 0;
  let double = true;
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

const generateFullCardNumber = (prefixDigit) => {
  let body = String(prefixDigit);
  for (let i = 0; i < 14; i++) body += crypto.randomInt(0, 10);
  return body + String(computeLuhnCheckDigit(body));
};

const generateCvv = () => String(crypto.randomInt(0, 1000)).padStart(3, '0');

const generateExpiry = (years = 3) => {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear() + years;
  const expiresAt = new Date(year, month, 0, 23, 59, 59, 999);
  return { month, year, expiresAt };
};

const formatCardholderName = (raw) =>
  String(raw || 'CARD HOLDER').trim().replace(/\s+/g, ' ').toUpperCase().slice(0, 26);

const mask = (full) => `•••• •••• •••• ${full.slice(-4)}`;

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

const createCardWithRetry = async (payload, tries = 5) => {
  for (let i = 0; i < tries; i++) {
    try {
      return await Card.create(payload);
    } catch (err) {
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

const listCardShape = (card) => ({
  _id: card._id,
  user: card.user,
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
// GET /admin/cards
// ═════════════════════════════════════════════════════════════
const getAllCardsAdmin = async (req, res) => {
  try {
    const {
      tier,
      status,
      userId,
      search,
      page = 1,
      limit = 20,
    } = req.query;

    const query = {};
    if (tier && tier !== 'all') query.tier = String(tier).toLowerCase();
    if (status && status !== 'all') query.status = status;
    if (userId && mongoose.Types.ObjectId.isValid(userId)) query.user = userId;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Optionally join user for display
    let cards = await Card.find(query)
      .populate('user', 'name email')
      .populate('generatedBy', 'name email role')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    // If searching by user name/email, filter post-populate (simple approach)
    if (search) {
      const q = String(search).toLowerCase();
      cards = cards.filter((c) =>
        (c.user?.name || '').toLowerCase().includes(q) ||
        (c.user?.email || '').toLowerCase().includes(q) ||
        (c.last4 || '').includes(q)
      );
    }

    const total = await Card.countDocuments(query);

    return sendSuccessResponseData(res, 'Cards retrieved', {
      cards: cards.map((c) => ({
        ...listCardShape(c),
        user: c.user,             // populated
        generatedBy: c.generatedBy,
      })),
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Admin get cards error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

// ═════════════════════════════════════════════════════════════
// GET /admin/cards/stats
// ═════════════════════════════════════════════════════════════
const getCardStatsAdmin = async (req, res) => {
  try {
    const [total, byTier, byStatus, issuedByAdmin, recent] = await Promise.all([
      Card.countDocuments(),
      Card.aggregate([
        { $group: { _id: '$tier', count: { $sum: 1 } } },
      ]),
      Card.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      Card.countDocuments({ createdByAdmin: true }),
      Card.countDocuments({
        createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      }),
    ]);

    return sendSuccessResponseData(res, 'Card stats retrieved', {
      total,
      issuedByAdmin,
      issuedLast7Days: recent,
      byTier,   // [{ _id: 'gold', count: N }, ...]
      byStatus, // [{ _id: 'active', count: N }, ...]
    });
  } catch (error) {
    console.error('Card stats error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

// ═════════════════════════════════════════════════════════════
// GET /admin/cards/:id
// ═════════════════════════════════════════════════════════════
const getCardByIdAdmin = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return sendNotFoundResponse(res, 'Card not found');
    }

    const card = await Card.findById(req.params.id)
      .populate('user', 'name email')
      .populate('generatedBy', 'name email role');

    if (!card) return sendNotFoundResponse(res, 'Card not found');

    return sendSuccessResponseData(res, 'Card retrieved', {
      card: {
        ...fullCardShape(card),
        user: card.user,
        generatedBy: card.generatedBy,
      },
    });
  } catch (error) {
    console.error('Admin get card error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

// ═════════════════════════════════════════════════════════════
// POST /admin/cards/generate
// Body: { userId, tier }
// Admin bypasses the balance gate.
// ═════════════════════════════════════════════════════════════
const generateCardForUserAdmin = async (req, res) => {
  try {
    const { userId, tier } = req.body;

    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return sendBadRequestResponse(res, 'Valid userId is required');
    }
    if (!tier || !['gold', 'black'].includes(String(tier).toLowerCase())) {
      return sendBadRequestResponse(res, 'tier must be "gold" or "black"');
    }

    const tierNorm = String(tier).toLowerCase();

    const user = await User.findById(userId);
    if (!user) return sendNotFoundResponse(res, 'User not found');

    // One live card per tier
    const existing = await Card.findOne({
      user: user._id,
      tier: tierNorm,
      status: { $in: ['active', 'frozen', 'expired'] },
    });

    if (existing) {
      return sendBadRequestResponse(
        res,
        `User already has a ${tierNorm} card`
      );
    }

    const payload = buildCardPayload({
      user,
      tier: tierNorm,
      generatedBy: req.user.userId,
      createdByAdmin: true,
    });

    const card = await createCardWithRetry(payload);

    return sendSuccessResponseData(
      res,
      'Card generated successfully',
      {
        card: {
          ...fullCardShape(card),
          user: { _id: user._id, name: user.name, email: user.email },
        },
      },
      201
    );
  } catch (error) {
    console.error('Admin generate card error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

// ═════════════════════════════════════════════════════════════
// POST /admin/cards/:id/freeze
// ═════════════════════════════════════════════════════════════
const freezeCardAdmin = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return sendNotFoundResponse(res, 'Card not found');
    }

    const card = await Card.findById(req.params.id);
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
    console.error('Admin freeze card error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

// ═════════════════════════════════════════════════════════════
// DELETE /admin/cards/:id
// ═════════════════════════════════════════════════════════════
const deleteCardAdmin = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return sendNotFoundResponse(res, 'Card not found');
    }

    const card = await Card.findById(req.params.id);
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
    console.error('Admin delete card error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

module.exports = {
  getAllCardsAdmin,
  getCardStatsAdmin,
  getCardByIdAdmin,
  generateCardForUserAdmin,
  freezeCardAdmin,
  deleteCardAdmin,
};