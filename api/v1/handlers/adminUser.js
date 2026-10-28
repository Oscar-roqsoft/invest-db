// app/v1/handlers/adminUser.js
const User = require('../models/user');
const {
  sendSuccessResponseData,
  sendBadRequestResponse,
  sendNotFoundResponse,
  sendUnauthenticatedErrorResponse,
} = require('../responses');

// mmm

/*
|--------------------------------------------------------------------------
| GET ALL USERS (admin)
|--------------------------------------------------------------------------
*/
const getAllUsers = async (req, res) => {
  try {
    const {
      search,
      role,
      kycStatus,
      isBanned,
      isVerified,
      page = 1,
      limit = 20,
      sort = 'newest',
    } = req.query;

    const query = {};
    if (role && role !== 'all') query.role = role;
    if (kycStatus && kycStatus !== 'all') query['kyc.status'] = kycStatus;
    if (isBanned === 'true') query.isBanned = true;
    if (isBanned === 'false') query.isBanned = false;
    if (isVerified === 'true') query.isVerified = true;
    if (isVerified === 'false') query.isVerified = false;

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
      ];
    }

    const sortMap = {
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      name: { name: 1 },
      balance: { 'balances.USD': -1 },
    };

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [users, total] = await Promise.all([
      User.find(query)
        .select('-password -pin -resetPasswordToken -resetPasswordExpire')
        .sort(sortMap[sort] || sortMap.newest)
        .skip(skip)
        .limit(parseInt(limit)),
      User.countDocuments(query),
    ]);

    return sendSuccessResponseData(
      res,
      'Users retrieved',
      {
        users,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / parseInt(limit)),
        },
      },
      200
    );
  } catch (error) {
    console.error('Get all users error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| GET USER BY ID (admin)
|--------------------------------------------------------------------------
*/
const getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select(
      '-password -pin -resetPasswordToken -resetPasswordExpire'
    );
    if (!user) return sendNotFoundResponse(res, 'User not found');

    return sendSuccessResponseData(res, 'User retrieved', { user }, 200);
  } catch (error) {
    console.error('Get user error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| BAN / UNBAN USER (admin)
|--------------------------------------------------------------------------
*/
const setBanStatus = async (req, res) => {
  try {
    const { isBanned, reason } = req.body;

    if (isBanned === undefined) {
      return sendBadRequestResponse(res, 'isBanned flag is required');
    }

    const user = await User.findById(req.params.id);
    if (!user) return sendNotFoundResponse(res, 'User not found');
    if (user.role === 'admin') {
      return sendBadRequestResponse(res, 'Cannot ban admin accounts');
    }

    user.isBanned = !!isBanned;
    if (user.isBanned && reason) {
      user.banReason = String(reason).trim().slice(0, 500);
    }
    await user.save();

    return sendSuccessResponseData(
      res,
      `User ${user.isBanned ? 'banned' : 'unbanned'}`,
      { user: { _id: user._id, isBanned: user.isBanned } },
      200
    );
  } catch (error) {
    console.error('Ban user error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| APPROVE / REJECT KYC (admin)
|--------------------------------------------------------------------------
*/
const reviewKYC = async (req, res) => {
  try {
    const { status, rejectionReason } = req.body;

    if (!status || !['approved', 'rejected'].includes(status)) {
      return sendBadRequestResponse(res, 'status must be "approved" or "rejected"');
    }

    if (status === 'rejected' && !rejectionReason) {
      return sendBadRequestResponse(res, 'Rejection reason is required');
    }

    const user = await User.findById(req.params.id);
    if (!user) return sendNotFoundResponse(res, 'User not found');
    if (user.kyc?.status !== 'pending') {
      return sendBadRequestResponse(res, `KYC is not pending (current: ${user.kyc?.status})`);
    }

    user.kyc.status = status;
    user.kyc.reviewedAt = new Date();
    user.kyc.reviewedBy = req.user.userId;

    if (status === 'rejected') {
      user.kyc.rejectionReason = String(rejectionReason).trim().slice(0, 500);
    }

    await user.save();

    return sendSuccessResponseData(res, `KYC ${status}`, { kyc: user.kyc }, 200);
  } catch (error) {
    console.error('Review KYC error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| UPDATE USER BY ADMIN (limited fields)
|--------------------------------------------------------------------------
*/
const adminUpdateUser = async (req, res) => {
  try {
    const allowed = ['name', 'phone', 'country', 'role', 'isVerified'];
    const updates = {};

    allowed.forEach((key) => {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    });

    if (updates.role && !['user', 'admin'].includes(updates.role)) {
      return sendBadRequestResponse(res, 'Invalid role');
    }

    const user = await User.findByIdAndUpdate(req.params.id, updates, { new: true }).select(
      '-password -pin -resetPasswordToken -resetPasswordExpire'
    );
    if (!user) return sendNotFoundResponse(res, 'User not found');

    return sendSuccessResponseData(res, 'User updated', { user }, 200);
  } catch (error) {
    console.error('Admin update user error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| USER STATS (admin dashboard)
|--------------------------------------------------------------------------
*/
const getUserStats = async (req, res) => {
  try {
    const [total, verified, banned, kycPending, kycApproved, newThisMonth] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ isVerified: true }),
      User.countDocuments({ isBanned: true }),
      User.countDocuments({ 'kyc.status': 'pending' }),
      User.countDocuments({ 'kyc.status': 'approved' }),
      User.countDocuments({
        createdAt: { $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
      }),
    ]);

    return sendSuccessResponseData(
      res,
      'User stats retrieved',
      {
        total,
        verified,
        banned,
        kycPending,
        kycApproved,
        newThisMonth,
        unverified: total - verified,
      },
      200
    );
  } catch (error) {
    console.error('User stats error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};


// ═════════════════════════════════════════════════════════════
// MANUAL ADJUSTMENTS
// ═════════════════════════════════════════════════════════════

/*
|--------------------------------------------------------------------------
| MANUAL CREDIT (admin credits a user's USD balance)
|--------------------------------------------------------------------------
| Body: { amount: number, reason: string, sendEmail?: boolean }
| Never fires referral commission. Creates a Transaction record.
|--------------------------------------------------------------------------
*/

const manualCredit = async (req, res) => {
  try {
    const { userId } = req.params;
    const { amount, reason, sendEmail = true } = req.body;

    // ─── Validate user ID ───
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return sendNotFoundResponse(res, 'User not found');
    }

    // ─── Validate amount ───
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt < MANUAL_ADJUSTMENT_MIN) {
      return sendBadRequestResponse(
        res,
        `Amount must be at least $${MANUAL_ADJUSTMENT_MIN}`
      );
    }
    if (amt > MANUAL_ADJUSTMENT_MAX) {
      return sendBadRequestResponse(
        res,
        `Amount exceeds maximum ($${MANUAL_ADJUSTMENT_MAX.toLocaleString()})`
      );
    }

    // ─── Validate reason ───
    const trimmedReason = String(reason || '').trim();
    if (trimmedReason.length < REASON_MIN_LENGTH) {
      return sendBadRequestResponse(
        res,
        `Reason is required (minimum ${REASON_MIN_LENGTH} characters)`
      );
    }
    if (trimmedReason.length > REASON_MAX_LENGTH) {
      return sendBadRequestResponse(
        res,
        `Reason too long (maximum ${REASON_MAX_LENGTH} characters)`
      );
    }

    // ─── Load user ───
    const user = await User.findById(userId);
    if (!user) return sendNotFoundResponse(res, 'User not found');
    if (user.isBanned) {
      return sendBadRequestResponse(res, 'Cannot credit a banned user');
    }

    // ─── Apply balance change ───
    const balanceBefore = Number(user.balances?.USD || 0);
    const balanceAfter = balanceBefore + amt;

    user.balances.USD = balanceAfter;
    user.totalDeposits = (user.totalDeposits || 0) + amt;
    await user.save();

    // ─── Create transaction ───
    const reference = `MDEP-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

    const transaction = await Transaction.create({
      user: user._id,
      type: 'deposit',
      currency: 'USD',
      amount: amt,
      amountCrypto: 0,
      balanceAfter,
      status: 'completed',
      reference,
      description: `Manual credit by admin`,
      completedAt: new Date(),
      metadata: {
        manual: true,
        adminId: req.user.userId,
        adminName: req.user.name || 'admin',
        reason: trimmedReason,
        balanceBefore,
        balanceAfter,
      },
    });

    // ─── Send email (best-effort) ───
    if (sendEmail) {
      sendTransactionEmail(user, {
        type: 'Account Credit',
        amount: amt,
        crypto: 'USD',
        status: 'Completed',
        reference,
      }).catch((err) =>
        console.error('Manual credit email error:', err.message)
      );
    }

    return sendSuccessResponseData(
      res,
      `$${amt.toFixed(2)} credited to ${user.name}`,
      {
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          balances: user.balances,
          totalDeposits: user.totalDeposits,
        },
        transaction: {
          _id: transaction._id,
          reference: transaction.reference,
          amount: transaction.amount,
          balanceAfter: transaction.balanceAfter,
        },
        balanceBefore,
        balanceAfter,
      },
      200
    );
  } catch (error) {
    console.error('Manual credit error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| MANUAL DEBIT (admin debits a user's USD balance)
|--------------------------------------------------------------------------
| Body: { amount: number, reason: string, sendEmail?: boolean }
| Fails if user's balance would go negative.
|--------------------------------------------------------------------------
*/
const manualDebit = async (req, res) => {
  try {
    const { userId } = req.params;
    const { amount, reason, sendEmail = true } = req.body;

    // ─── Validate user ID ───
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return sendNotFoundResponse(res, 'User not found');
    }

    // ─── Validate amount ───
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt < MANUAL_ADJUSTMENT_MIN) {
      return sendBadRequestResponse(
        res,
        `Amount must be at least $${MANUAL_ADJUSTMENT_MIN}`
      );
    }
    if (amt > MANUAL_ADJUSTMENT_MAX) {
      return sendBadRequestResponse(
        res,
        `Amount exceeds maximum ($${MANUAL_ADJUSTMENT_MAX.toLocaleString()})`
      );
    }

    // ─── Validate reason ───
    const trimmedReason = String(reason || '').trim();
    if (trimmedReason.length < REASON_MIN_LENGTH) {
      return sendBadRequestResponse(
        res,
        `Reason is required (minimum ${REASON_MIN_LENGTH} characters)`
      );
    }
    if (trimmedReason.length > REASON_MAX_LENGTH) {
      return sendBadRequestResponse(
        res,
        `Reason too long (maximum ${REASON_MAX_LENGTH} characters)`
      );
    }

    // ─── Load user ───
    const user = await User.findById(userId);
    if (!user) return sendNotFoundResponse(res, 'User not found');
    if (user.isBanned) {
      return sendBadRequestResponse(res, 'Cannot debit a banned user');
    }

    // ─── Check sufficient balance ───
    const balanceBefore = Number(user.balances?.USD || 0);
    if (amt > balanceBefore) {
      return sendBadRequestResponse(
        res,
        `Insufficient balance. User has $${balanceBefore.toFixed(2)}, tried to debit $${amt.toFixed(2)}`
      );
    }

    // ─── Apply balance change ───
    const balanceAfter = balanceBefore - amt;

    user.balances.USD = balanceAfter;
    user.totalWithdrawals = (user.totalWithdrawals || 0) + amt;
    await user.save();

    // ─── Create transaction ───
    const reference = `MWTH-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

    const transaction = await Transaction.create({
      user: user._id,
      type: 'withdrawal',
      currency: 'USD',
      amount: amt,
      amountCrypto: 0,
      balanceAfter,
      status: 'completed',
      reference,
      description: `Manual debit by admin`,
      completedAt: new Date(),
      metadata: {
        manual: true,
        adminId: req.user.userId,
        adminName: req.user.name || 'admin',
        reason: trimmedReason,
        balanceBefore,
        balanceAfter,
      },
    });

    // ─── Send email (best-effort) ───
    if (sendEmail) {
      sendTransactionEmail(user, {
        type: 'Account Debit',
        amount: amt,
        crypto: 'USD',
        status: 'Completed',
        reference,
      }).catch((err) =>
        console.error('Manual debit email error:', err.message)
      );
    }

    return sendSuccessResponseData(
      res,
      `$${amt.toFixed(2)} debited from ${user.name}`,
      {
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          balances: user.balances,
          totalWithdrawals: user.totalWithdrawals,
        },
        transaction: {
          _id: transaction._id,
          reference: transaction.reference,
          amount: transaction.amount,
          balanceAfter: transaction.balanceAfter,
        },
        balanceBefore,
        balanceAfter,
      },
      200
    );
  } catch (error) {
    console.error('Manual debit error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

module.exports = {
  getAllUsers,
  getUserById,
  setBanStatus,
  reviewKYC,
  adminUpdateUser,
  getUserStats,
  manualCredit,
  manualDebit,
};