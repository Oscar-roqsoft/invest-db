// app/v1/handlers/adminUser.js
const User = require('../models/user');
const {
  sendSuccessResponseData,
  sendBadRequestResponse,
  sendNotFoundResponse,
  sendUnauthenticatedErrorResponse,
} = require('../responses');

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

module.exports = {
  getAllUsers,
  getUserById,
  setBanStatus,
  reviewKYC,
  adminUpdateUser,
  getUserStats,
};