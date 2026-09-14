// app/v1/handlers/adminKyc.js
const User = require('../models/user');
const Transaction = require('../models/transaction');
const { createTransaction } = require('../../../utils/transactionHelper');
const { generateReference } = require('../../../utils/authUtils');
const {
  sendSuccessResponseData,
  sendBadRequestResponse,
  sendNotFoundResponse,
  sendUnauthenticatedErrorResponse,
} = require('../responses');

/*
|--------------------------------------------------------------------------
| GET ALL KYC SUBMISSIONS (with filters)
|--------------------------------------------------------------------------
*/
const getAllKycSubmissions = async (req, res) => {
  try {
    const {
      status = 'pending',
      documentType,
      search,
      from,
      to,
      page = 1,
      limit = 20,
      sort = 'oldest',
    } = req.query;

    // Only fetch users who have submitted KYC
    const query = { 'kyc.status': { $ne: 'not_started' } };

    if (status && status !== 'all') {
      query['kyc.status'] = status;
    }

    if (documentType && documentType !== 'all') {
      query['kyc.documentType'] = documentType;
    }

    if (from || to) {
      query['kyc.submittedAt'] = {};
      if (from) query['kyc.submittedAt'].$gte = new Date(from);
      if (to) query['kyc.submittedAt'].$lte = new Date(to);
    }

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { 'kyc.documentNumber': { $regex: search, $options: 'i' } },
      ];
    }

    const sortMap = {
      newest: { 'kyc.submittedAt': -1 },
      oldest: { 'kyc.submittedAt': 1 },
      name: { name: 1 },
    };

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [submissions, total] = await Promise.all([
      User.find(query)
        .select(
          'name email phone country avatar kyc createdAt isVerified isBanned referralCode'
        )
        .sort(sortMap[sort] || sortMap.oldest)
        .skip(skip)
        .limit(parseInt(limit)),
      User.countDocuments(query),
    ]);

    return sendSuccessResponseData(
      res,
      'KYC submissions retrieved',
      {
        submissions,
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
    console.error('Get all KYC submissions error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| GET KYC SUBMISSION BY USER ID
|--------------------------------------------------------------------------
*/
const getKycSubmission = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId).select(
      'name email phone country city address dateOfBirth gender avatar kyc createdAt isVerified'
    );

    if (!user) return sendNotFoundResponse(res, 'User not found');

    if (!user.kyc || user.kyc.status === 'not_started') {
      return sendNotFoundResponse(res, 'This user has not submitted KYC');
    }

    return sendSuccessResponseData(res, 'KYC submission retrieved', { user }, 200);
  } catch (error) {
    console.error('Get KYC submission error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| APPROVE KYC
|--------------------------------------------------------------------------
*/
const approveKyc = async (req, res) => {
  try {
    const { note } = req.body;

    const user = await User.findById(req.params.userId);
    if (!user) return sendNotFoundResponse(res, 'User not found');

    if (!user.kyc || user.kyc.status === 'not_started') {
      return sendBadRequestResponse(res, 'This user has not submitted KYC');
    }

    if (user.kyc.status === 'approved') {
      return sendBadRequestResponse(res, 'KYC is already approved');
    }

    user.kyc.status = 'approved';
    user.kyc.reviewedAt = new Date();
    user.kyc.reviewedBy = req.user.userId;
    user.kyc.rejectionReason = undefined;
    if (note) user.kyc.adminNote = String(note).trim().slice(0, 500);

    await user.save();

    // Send notification email (optional — implement if you have the helper)
    // await sendKycApprovedEmail(user).catch(err => console.error(err));

    // Create a "system notification" transaction? Optional.
    // Some platforms log KYC approval as a system event.

    return sendSuccessResponseData(
      res,
      `KYC approved for ${user.name}`,
      {
        userId: user._id,
        kyc: user.kyc,
      },
      200
    );
  } catch (error) {
    console.error('Approve KYC error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| REJECT KYC
|--------------------------------------------------------------------------
*/
const rejectKyc = async (req, res) => {
  try {
    const { rejectionReason } = req.body;

    if (!rejectionReason || !String(rejectionReason).trim()) {
      return sendBadRequestResponse(res, 'Rejection reason is required');
    }

    const user = await User.findById(req.params.userId);
    if (!user) return sendNotFoundResponse(res, 'User not found');

    if (!user.kyc || user.kyc.status === 'not_started') {
      return sendBadRequestResponse(res, 'This user has not submitted KYC');
    }

    if (user.kyc.status === 'rejected') {
      return sendBadRequestResponse(res, 'KYC is already rejected');
    }

    user.kyc.status = 'rejected';
    user.kyc.reviewedAt = new Date();
    user.kyc.reviewedBy = req.user.userId;
    user.kyc.rejectionReason = String(rejectionReason).trim().slice(0, 500);

    await user.save();

    // Send notification email (optional)
    // await sendKycRejectedEmail(user, user.kyc.rejectionReason).catch(err => console.error(err));

    return sendSuccessResponseData(
      res,
      `KYC rejected for ${user.name}`,
      {
        userId: user._id,
        kyc: user.kyc,
      },
      200
    );
  } catch (error) {
    console.error('Reject KYC error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| REQUEST RE-SUBMISSION (soft rejection — user can try again)
|--------------------------------------------------------------------------
| Different from reject: user can re-submit without waiting.
|--------------------------------------------------------------------------
*/
const requestResubmission = async (req, res) => {
  try {
    const { reason } = req.body;

    if (!reason || !String(reason).trim()) {
      return sendBadRequestResponse(res, 'Reason is required');
    }

    const user = await User.findById(req.params.userId);
    if (!user) return sendNotFoundResponse(res, 'User not found');

    if (!user.kyc || user.kyc.status === 'not_started') {
      return sendBadRequestResponse(res, 'This user has not submitted KYC');
    }

    // Reset KYC to allow resubmission
    user.kyc = {
      status: 'not_started',
      documentType: undefined,
      documentNumber: undefined,
      documentUrl: undefined,
      selfieUrl: undefined,
      submittedAt: undefined,
      reviewedAt: new Date(),
      reviewedBy: req.user.userId,
      rejectionReason: String(reason).trim().slice(0, 500),
      requiresResubmission: true,
    };

    await user.save();

    return sendSuccessResponseData(
      res,
      `Re-submission requested from ${user.name}`,
      { userId: user._id, kyc: user.kyc },
      200
    );
  } catch (error) {
    console.error('Request resubmission error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| BULK APPROVE KYC
|--------------------------------------------------------------------------
| Approve multiple submissions at once.
|--------------------------------------------------------------------------
*/
const bulkApproveKyc = async (req, res) => {
  try {
    const { userIds } = req.body;

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return sendBadRequestResponse(res, 'userIds array is required');
    }

    if (userIds.length > 50) {
      return sendBadRequestResponse(res, 'Maximum 50 users per bulk operation');
    }

    const result = await User.updateMany(
      {
        _id: { $in: userIds },
        'kyc.status': 'pending',
      },
      {
        $set: {
          'kyc.status': 'approved',
          'kyc.reviewedAt': new Date(),
          'kyc.reviewedBy': req.user.userId,
          'kyc.rejectionReason': undefined,
        },
      }
    );

    return sendSuccessResponseData(
      res,
      `${result.modifiedCount} KYC submissions approved`,
      { approved: result.modifiedCount, requested: userIds.length },
      200
    );
  } catch (error) {
    console.error('Bulk approve KYC error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| BULK REJECT KYC
|--------------------------------------------------------------------------
*/
const bulkRejectKyc = async (req, res) => {
  try {
    const { userIds, rejectionReason } = req.body;

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return sendBadRequestResponse(res, 'userIds array is required');
    }

    if (!rejectionReason || !String(rejectionReason).trim()) {
      return sendBadRequestResponse(res, 'Rejection reason is required');
    }

    if (userIds.length > 50) {
      return sendBadRequestResponse(res, 'Maximum 50 users per bulk operation');
    }

    const reason = String(rejectionReason).trim().slice(0, 500);

    const result = await User.updateMany(
      {
        _id: { $in: userIds },
        'kyc.status': 'pending',
      },
      {
        $set: {
          'kyc.status': 'rejected',
          'kyc.reviewedAt': new Date(),
          'kyc.reviewedBy': req.user.userId,
          'kyc.rejectionReason': reason,
        },
      }
    );

    return sendSuccessResponseData(
      res,
      `${result.modifiedCount} KYC submissions rejected`,
      { rejected: result.modifiedCount, requested: userIds.length },
      200
    );
  } catch (error) {
    console.error('Bulk reject KYC error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| GET KYC STATS
|--------------------------------------------------------------------------
*/
const getKycStats = async (req, res) => {
  try {
    const [total, pending, approved, rejected, notStarted, todaySubmitted] =
      await Promise.all([
        User.countDocuments(),
        User.countDocuments({ 'kyc.status': 'pending' }),
        User.countDocuments({ 'kyc.status': 'approved' }),
        User.countDocuments({ 'kyc.status': 'rejected' }),
        User.countDocuments({ 'kyc.status': 'not_started' }),
        User.countDocuments({
          'kyc.submittedAt': {
            $gte: new Date(new Date().setHours(0, 0, 0, 0)),
          },
        }),
      ]);

    // By document type
    const byDocumentType = await User.aggregate([
      { $match: { 'kyc.documentType': { $exists: true, $ne: null } } },
      {
        $group: {
          _id: '$kyc.documentType',
          count: { $sum: 1 },
        },
      },
    ]);

    // Average review time (only for reviewed submissions)
    const reviewTimes = await User.aggregate([
      {
        $match: {
          'kyc.submittedAt': { $exists: true },
          'kyc.reviewedAt': { $exists: true },
        },
      },
      {
        $project: {
          reviewTimeMs: { $subtract: ['$kyc.reviewedAt', '$kyc.submittedAt'] },
        },
      },
      {
        $group: {
          _id: null,
          avgTime: { $avg: '$reviewTimeMs' },
        },
      },
    ]);

    const avgReviewHours = reviewTimes[0]
      ? (reviewTimes[0].avgTime / (1000 * 60 * 60)).toFixed(1)
      : 0;

    const approvalRate =
      approved + rejected > 0
        ? ((approved / (approved + rejected)) * 100).toFixed(1)
        : 0;

    return sendSuccessResponseData(
      res,
      'KYC stats retrieved',
      {
        total,
        pending,
        approved,
        rejected,
        notStarted,
        todaySubmitted,
        approvalRate: parseFloat(approvalRate),
        avgReviewHours: parseFloat(avgReviewHours),
        byDocumentType,
      },
      200
    );
  } catch (error) {
    console.error('KYC stats error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| GET KYC REVIEW HISTORY (who reviewed what, when)
|--------------------------------------------------------------------------
*/
const getKycHistory = async (req, res) => {
  try {
    const { reviewerId, from, to, page = 1, limit = 30 } = req.query;

    const query = {
      'kyc.reviewedAt': { $exists: true },
      'kyc.reviewedBy': { $exists: true },
    };

    if (reviewerId) query['kyc.reviewedBy'] = reviewerId;

    if (from || to) {
      query['kyc.reviewedAt'] = {};
      if (from) query['kyc.reviewedAt'].$gte = new Date(from);
      if (to) query['kyc.reviewedAt'].$lte = new Date(to);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [records, total] = await Promise.all([
      User.find(query)
        .select('name email kyc')
        .populate('kyc.reviewedBy', 'name email')
        .sort({ 'kyc.reviewedAt': -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      User.countDocuments(query),
    ]);

    return sendSuccessResponseData(
      res,
      'KYC review history retrieved',
      {
        records,
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
    console.error('KYC history error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

module.exports = {
  getAllKycSubmissions,
  getKycSubmission,
  approveKyc,
  rejectKyc,
  requestResubmission,
  bulkApproveKyc,
  bulkRejectKyc,
  getKycStats,
  getKycHistory,
};