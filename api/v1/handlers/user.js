// app/v1/handlers/user.js
const crypto = require('crypto');
const User = require('../models/user');
const cache = require('../../../db/cache');
const {
  sanitizeUser,
  validatePassword,
} = require('../../../utils/authUtils');
const {
  sendSuccessResponseData,
  sendBadRequestResponse,
  sendNotFoundResponse,
  sendConflictResponse,
  sendUnauthenticatedErrorResponse,
} = require('../responses');

/*
|--------------------------------------------------------------------------
| GET MY PROFILE
|--------------------------------------------------------------------------
*/
const getMyProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) return sendNotFoundResponse(res, 'User not found');

    const safeUser = sanitizeUser(user);

    // Add profile completion percentage
    const completion = calculateProfileCompletion(user);

    return sendSuccessResponseData(
      res,
      'Profile retrieved',
      { user: safeUser, completion },
      200
    );
  } catch (error) {
    console.error('Get profile error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| UPDATE PROFILE (name, phone, country, bio, etc.)
|--------------------------------------------------------------------------
*/
const updateProfile = async (req, res) => {
  try {
    const {
      name,
      phone,
      country,
      city,
      address,
      dateOfBirth,
      gender,
      bio,
    } = req.body;

    const user = await User.findById(req.user.userId);
    if (!user) return sendNotFoundResponse(res, 'User not found');

    // Validate name if provided
    if (name !== undefined) {
      const trimmed = String(name).trim();
      if (trimmed.length < 2) {
        return sendBadRequestResponse(res, 'Name must be at least 2 characters');
      }
      if (trimmed.length > 60) {
        return sendBadRequestResponse(res, 'Name is too long');
      }
      user.name = trimmed;
    }

    if (phone !== undefined) {
      const trimmed = String(phone).trim();
      // Basic phone validation (digits, spaces, +, -, parentheses)
      if (trimmed && !/^[\d\s\+\-\(\)]{6,20}$/.test(trimmed)) {
        return sendBadRequestResponse(res, 'Invalid phone number');
      }
      user.phone = trimmed;
    }

    if (country !== undefined) user.country = String(country).trim();
    if (city !== undefined) user.city = String(city).trim();
    if (address !== undefined) user.address = String(address).trim();

    if (dateOfBirth !== undefined && dateOfBirth) {
      const dob = new Date(dateOfBirth);
      if (isNaN(dob.getTime())) {
        return sendBadRequestResponse(res, 'Invalid date of birth');
      }
      // Must be at least 18 years old
      const age = (Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
      if (age < 18) {
        return sendBadRequestResponse(res, 'You must be at least 18 years old');
      }
      user.dateOfBirth = dob;
    }

    if (gender !== undefined) {
      const g = String(gender).toLowerCase().trim();
      if (g && !['male', 'female', 'other'].includes(g)) {
        return sendBadRequestResponse(res, 'Invalid gender');
      }
      user.gender = g;
    }

    if (bio !== undefined) {
      const b = String(bio).trim();
      if (b.length > 200) {
        return sendBadRequestResponse(res, 'Bio cannot exceed 200 characters');
      }
      user.bio = b;
    }

    await user.save();

    const safeUser = sanitizeUser(user);
    const completion = calculateProfileCompletion(user);

    return sendSuccessResponseData(
      res,
      'Profile updated successfully',
      { user: safeUser, completion },
      200
    );
  } catch (error) {
    console.error('Update profile error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| UPDATE AVATAR (URL — you upload the file elsewhere)
|--------------------------------------------------------------------------
*/
const updateAvatar = async (req, res) => {
  try {
    const { avatar } = req.body;

    if (!avatar || typeof avatar !== 'string') {
      return sendBadRequestResponse(res, 'Avatar URL is required');
    }

    const user = await User.findById(req.user.userId);
    if (!user) return sendNotFoundResponse(res, 'User not found');

    user.avatar = avatar.trim();
    await user.save();

    const safeUser = sanitizeUser(user);

    return sendSuccessResponseData(res, 'Avatar updated', { user: safeUser }, 200);
  } catch (error) {
    console.error('Update avatar error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| CHANGE PASSWORD (with current password verification)
|--------------------------------------------------------------------------
| Note: this is the SECURITY-tab version, requires currentPassword.
| The /auth/update-password route is a simpler variant.
|--------------------------------------------------------------------------
*/
const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return sendBadRequestResponse(res, 'Current and new password are required');
    }

    if (currentPassword === newPassword) {
      return sendBadRequestResponse(res, 'New password must differ from current password');
    }

    const errors = validatePassword(newPassword);
    if (errors.length > 0) {
      return sendBadRequestResponse(res, errors[0]);
    }

    const user = await User.findById(req.user.userId).select('+password');
    if (!user) return sendNotFoundResponse(res, 'User not found');

    const isCorrect = await user.comparePassword(currentPassword);
    if (!isCorrect) {
      return sendBadRequestResponse(res, 'Current password is incorrect');
    }

    user.password = newPassword;
    await user.save();

    return sendSuccessResponseData(res, 'Password changed successfully', null, 200);
  } catch (error) {
    console.error('Change password error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| SET PIN (first-time setup)
|--------------------------------------------------------------------------
*/
const setPin = async (req, res) => {
  try {
    const { pin, password } = req.body;

    if (!pin || !password) {
      return sendBadRequestResponse(res, 'PIN and password are required');
    }

    if (!/^\d{4,6}$/.test(String(pin))) {
      return sendBadRequestResponse(res, 'PIN must be 4-6 digits');
    }

    const user = await User.findById(req.user.userId).select('+password');
    if (!user) return sendNotFoundResponse(res, 'User not found');

    if (user.isPinSet) {
      return sendBadRequestResponse(res, 'PIN is already set. Use change-pin endpoint');
    }

    const isCorrect = await user.comparePassword(password);
    if (!isCorrect) {
      return sendBadRequestResponse(res, 'Password is incorrect');
    }

    user.pin = String(pin);
    user.isPinSet = true;
    await user.save();

    return sendSuccessResponseData(res, 'PIN set successfully', null, 200);
  } catch (error) {
    console.error('Set PIN error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| CHANGE PIN (requires current PIN)
|--------------------------------------------------------------------------
*/
const changePin = async (req, res) => {
  try {
    const { currentPin, newPin, password } = req.body;

    if (!currentPin || !newPin || !password) {
      return sendBadRequestResponse(res, 'Current PIN, new PIN, and password are required');
    }

    if (!/^\d{4,6}$/.test(String(newPin))) {
      return sendBadRequestResponse(res, 'New PIN must be 4-6 digits');
    }

    if (String(currentPin) === String(newPin)) {
      return sendBadRequestResponse(res, 'New PIN must differ from current PIN');
    }

    const user = await User.findById(req.user.userId).select('+password +pin');
    if (!user) return sendNotFoundResponse(res, 'User not found');

    if (!user.isPinSet) {
      return sendBadRequestResponse(res, 'No PIN set. Use set-pin endpoint');
    }

    const pinCorrect = await user.comparePin(String(currentPin));
    if (!pinCorrect) {
      return sendBadRequestResponse(res, 'Current PIN is incorrect');
    }

    const passwordCorrect = await user.comparePassword(password);
    if (!passwordCorrect) {
      return sendBadRequestResponse(res, 'Password is incorrect');
    }

    user.pin = String(newPin);
    await user.save();

    return sendSuccessResponseData(res, 'PIN changed successfully', null, 200);
  } catch (error) {
    console.error('Change PIN error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| TOGGLE 2FA (email-based for now)
|--------------------------------------------------------------------------
*/
const toggle2FA = async (req, res) => {
  try {
    const { enabled, password } = req.body;

    if (enabled === undefined) {
      return sendBadRequestResponse(res, 'Enabled flag is required');
    }

    if (!password) {
      return sendBadRequestResponse(res, 'Password is required to change 2FA');
    }

    const user = await User.findById(req.user.userId).select('+password');
    if (!user) return sendNotFoundResponse(res, 'User not found');

    const isCorrect = await user.comparePassword(password);
    if (!isCorrect) {
      return sendBadRequestResponse(res, 'Password is incorrect');
    }

    user.twoFactorVerification = !!enabled;
    await user.save();

    return sendSuccessResponseData(
      res,
      `Two-factor authentication ${user.twoFactorVerification ? 'enabled' : 'disabled'}`,
      { twoFactorVerification: user.twoFactorVerification },
      200
    );
  } catch (error) {
    console.error('Toggle 2FA error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| SUBMIT KYC (verification)
|--------------------------------------------------------------------------
*/
const submitKYC = async (req, res) => {
  try {
    const { documentType, documentNumber, documentUrl, selfieUrl } = req.body;

    if (!documentType || !documentUrl) {
      return sendBadRequestResponse(res, 'Document type and document URL are required');
    }

    const validTypes = ['passport', 'national_id', 'drivers_license'];
    if (!validTypes.includes(String(documentType).toLowerCase())) {
      return sendBadRequestResponse(
        res,
        'Invalid document type. Use: passport, national_id, or drivers_license'
      );
    }

    const user = await User.findById(req.user.userId);
    if (!user) return sendNotFoundResponse(res, 'User not found');

    if (user.kyc?.status === 'approved') {
      return sendBadRequestResponse(res, 'KYC is already approved');
    }

    if (user.kyc?.status === 'pending') {
      return sendBadRequestResponse(res, 'KYC is already under review');
    }

    user.kyc = {
      status: 'pending',
      documentType: String(documentType).toLowerCase(),
      documentNumber: documentNumber ? String(documentNumber).trim() : '',
      documentUrl: String(documentUrl).trim(),
      selfieUrl: selfieUrl ? String(selfieUrl).trim() : '',
      submittedAt: new Date(),
    };

    await user.save();

    return sendSuccessResponseData(
      res,
      'KYC submitted successfully. We will review it within 24-48 hours.',
      { kyc: user.kyc },
      200
    );
  } catch (error) {
    console.error('Submit KYC error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| GET SECURITY OVERVIEW (score, 2FA status, etc.)
|--------------------------------------------------------------------------
*/
const getSecurityOverview = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) return sendNotFoundResponse(res, 'User not found');

    const security = {
      isVerified: user.isVerified,
      isPinSet: user.isPinSet,
      twoFactorVerification: user.twoFactorVerification,
      kycStatus: user.kyc?.status || 'not_started',
      hasPhone: !!user.phone,
      score: calculateSecurityScore(user),
    };

    return sendSuccessResponseData(res, 'Security overview retrieved', { security }, 200);
  } catch (error) {
    console.error('Get security error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| DELETE ACCOUNT (with password confirmation)
|--------------------------------------------------------------------------
*/
const deleteAccount = async (req, res) => {
  try {
    const { password, reason } = req.body;

    if (!password) {
      return sendBadRequestResponse(res, 'Password is required to delete account');
    }

    const user = await User.findById(req.user.userId).select('+password');
    if (!user) return sendNotFoundResponse(res, 'User not found');

    const isCorrect = await user.comparePassword(password);
    if (!isCorrect) {
      return sendBadRequestResponse(res, 'Password is incorrect');
    }

    // Prevent admin self-deletion via this endpoint
    if (user.role === 'admin') {
      return sendBadRequestResponse(res, 'Admin accounts cannot be deleted here');
    }

    // Soft-delete: ban the user + scramble email so they can't log in
    const scrambledEmail = `deleted_${Date.now()}_${user.email}`;
    user.isBanned = true;
    user.email = scrambledEmail;
    user.deletedAt = new Date();
    user.deletionReason = reason ? String(reason).trim().slice(0, 500) : '';
    await user.save();

    return sendSuccessResponseData(res, 'Account deleted successfully', null, 200);
  } catch (error) {
    console.error('Delete account error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────
function calculateProfileCompletion(user) {
  const fields = [
    { key: 'name', weight: 15 },
    { key: 'phone', weight: 15 },
    { key: 'country', weight: 10 },
    { key: 'city', weight: 5 },
    { key: 'address', weight: 5 },
    { key: 'dateOfBirth', weight: 10 },
    { key: 'avatar', weight: 10 },
    { key: 'bio', weight: 5 },
  ];

  let score = 0;
  fields.forEach((f) => {
    if (user[f.key]) score += f.weight;
  });

  // KYC approved = extra 25
  if (user.kyc?.status === 'approved') score += 25;

  return {
    percentage: Math.min(score, 100),
    filledFields: fields.filter((f) => user[f.key]).map((f) => f.key),
    missingFields: fields.filter((f) => !user[f.key]).map((f) => f.key),
  };
}

function calculateSecurityScore(user) {
  let score = 0;
  if (user.isVerified) score += 20;
  if (user.isPinSet) score += 25;
  if (user.twoFactorVerification) score += 30;
  if (user.phone) score += 10;
  if (user.kyc?.status === 'approved') score += 15;
  return Math.min(score, 100);
}

module.exports = {
  getMyProfile,
  updateProfile,
  updateAvatar,
  changePassword,
  setPin,
  changePin,
  toggle2FA,
  submitKYC,
  getSecurityOverview,
  deleteAccount,
};