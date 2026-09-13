// handlers/auth.js
const User = require('../models/user');
const crypto = require('crypto');
const cache = require('../../../db/cache');
const {
  generateOTP,
  validatePassword,
  validateEmail,
  sanitizeUser,
  hashToken,
} = require('../../../utils/authUtils');
const {
  sendOTPEmail,
  sendWelcomeEmail,
  sendPasswordResetEmail,
} = require('../../../utils/emailUtils');
const {
  sendConflictResponse,
  sendBadRequestResponse,
  sendUnauthenticatedErrorResponse,
  sendNotFoundResponse,
  sendSuccessResponseData,
} = require('../responses');

/*
|--------------------------------------------------------------------------
| REGISTER
|--------------------------------------------------------------------------
*/
const register = async (req, res) => {
  try {
    const { name, email, password, referralCode } = req.body;

    // Validate required fields
    if (!name || !email || !password) {
      return sendBadRequestResponse(res, 'Please provide name, email, and password');
    }

    if (!validateEmail(email)) {
      return sendBadRequestResponse(res, 'Please provide a valid email address');
    }

    const passwordErrors = validatePassword(password);
    if (passwordErrors.length > 0) {
      return sendBadRequestResponse(res, passwordErrors[0]);
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check if user exists
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return sendConflictResponse(res, 'Email already exists');
    }

    // Check referral code if provided
    let referrer = null;
    if (referralCode) {
      referrer = await User.findOne({
        referralCode: referralCode.toUpperCase().trim()
      });
    }

    // Create user
    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password,
      phone: '',
      country: '',
      referredBy: referrer ? referrer._id : null,
      balances: {
        USD: 0,
        BTC: 0,
        ETH: 0,
        USDT: 0,
        USDC: 0,
        BNB: 0,
        SOL: 0
      },
      isVerified: false
    });

    // Generate JWT
    const token = user.createJWT();
    const refreshToken = user.createRefreshToken();
    const safeUser = sanitizeUser(user);

    // Send OTP email
    await sendOTPEmail(safeUser, token);

    return sendSuccessResponseData(
      res,
      'User registered successfully. OTP sent to email.',
      {
        user: null,
        token,
        refreshToken,
        requiresVerification: true
      }
    );
  } catch (error) {
    console.error('Register error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| VERIFY OTP
|--------------------------------------------------------------------------
*/
const verifyOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return sendBadRequestResponse(res, 'Email and OTP required');
    }

    const normalizedEmail = email.toLowerCase().trim();
    const cacheKey = `otp:${normalizedEmail}`;
    const storedOTP = cache.get(cacheKey);

    if (!storedOTP) {
      return sendBadRequestResponse(res, 'OTP expired or invalid');
    }

    if (storedOTP !== String(otp).trim()) {
      return sendBadRequestResponse(res, 'Invalid OTP');
    }

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return sendBadRequestResponse(res, 'User not found');
    }

    if (user.isVerified) {
      return sendBadRequestResponse(res, 'Email already verified');
    }

    user.isVerified = true;
    await user.save();

    cache.delete(cacheKey);

    const safeUser = sanitizeUser(user);
    const token = user.createJWT();
    const refreshToken = user.createRefreshToken();

    // Send welcome email (fire and forget)
    sendWelcomeEmail(safeUser).catch(err =>
      console.error('Welcome email error:', err.message)
    );

    return sendSuccessResponseData(res, 'Email verified successfully', {
      token,
      refreshToken,
      user: safeUser
    });
  } catch (error) {
    console.error('Verify OTP error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| RESEND OTP
|--------------------------------------------------------------------------
*/
const resendOTP = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return sendBadRequestResponse(res, 'Email is required');
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      return sendBadRequestResponse(res, 'User not found');
    }

    if (user.isVerified) {
      return sendBadRequestResponse(res, 'Email already verified');
    }

    const token = user.createJWT();
    const safeUser = sanitizeUser(user);
    await sendOTPEmail(safeUser, token);

    return sendSuccessResponseData(res, 'OTP resent successfully', null);
  } catch (error) {
    console.error('Resend OTP error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| LOGIN
|--------------------------------------------------------------------------
*/
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return sendBadRequestResponse(res, 'Email and password required');
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() }).select('+password');

    if (!user) {
      return sendBadRequestResponse(res, 'Invalid credentials');
    }

    if (user.isBanned) {
      return sendUnauthenticatedErrorResponse(res, 'Account suspended. Contact support.');
    }

    const isPasswordCorrect = await user.comparePassword(password);
    if (!isPasswordCorrect) {
      return sendBadRequestResponse(res, 'Invalid credentials');
    }

    // Check if verified
    if (!user.isVerified) {
      const token = user.createJWT();
      const safeUser = sanitizeUser(user);
      await sendOTPEmail(safeUser, null);

      return sendSuccessResponseData(
        res,
        'Account not verified. OTP sent to your email.',
        {
          token,
          user: safeUser,
          requiresVerification: true
        }
      );
    }

    // Update last login
    user.lastLogin = new Date();
    user.lastLoginIp = req.ip;
    await user.save({ validateBeforeSave: false });

    const token = user.createJWT();
    const refreshToken = user.createRefreshToken();
    const safeUser = sanitizeUser(user);

    return sendSuccessResponseData(res, 'Login successful', {
      token,
      refreshToken,
      user: safeUser
    });
  } catch (error) {
    console.error('Login error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| REFRESH TOKEN
|--------------------------------------------------------------------------
*/
const refreshToken = async (req, res) => {
  try {
    const { refreshToken: incomingToken } = req.body;

    if (!incomingToken) {
      return sendBadRequestResponse(res, 'Refresh token required');
    }

    const jwt = require('jsonwebtoken');
    let decoded;

    try {
      decoded = jwt.verify(incomingToken, process.env.JWT_REFRESH_SECRET);
    } catch (err) {
      return sendUnauthenticatedErrorResponse(res, 'Invalid refresh token');
    }

    const user = await User.findById(decoded.userId);
    if (!user || user.isBanned) {
      return sendUnauthenticatedErrorResponse(res, 'User not found');
    }

    const newToken = user.createJWT();
    const newRefreshToken = user.createRefreshToken();

    return sendSuccessResponseData(res, 'Token refreshed', {
      token: newToken,
      refreshToken: newRefreshToken
    });
  } catch (error) {
    console.error('Refresh token error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
  
};

/*
|--------------------------------------------------------------------------
| FORGOT PASSWORD
|--------------------------------------------------------------------------
*/
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return sendBadRequestResponse(res, 'Email is required');
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      return sendNotFoundResponse(res, 'User not found');
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = hashToken(resetToken);

    user.resetPasswordToken = hashedToken;
    user.resetPasswordExpire = Date.now() + 3600000; // 1 hour
    await user.save({ validateBeforeSave: false });

    const safeUser = sanitizeUser(user);
    await sendPasswordResetEmail(safeUser, resetToken);

    return sendSuccessResponseData(res, 'Password reset link sent to your email', null);
  } catch (error) {
    console.error('Forgot password error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| RESET PASSWORD
|--------------------------------------------------------------------------
*/
const resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return sendBadRequestResponse(res, 'Token and new password required');
    }

    const passwordErrors = validatePassword(newPassword);
    if (passwordErrors.length > 0) {
      return sendBadRequestResponse(res, passwordErrors[0]);
    }

    const hashedToken = hashToken(token);

    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpire: { $gt: Date.now() }
    });

    if (!user) {
      return sendBadRequestResponse(res, 'Invalid or expired reset token');
    }

    user.password = newPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save();

    return sendSuccessResponseData(res, 'Password reset successfully', null);
  } catch (error) {
    console.error('Reset password error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| UPDATE PASSWORD (authenticated)
|--------------------------------------------------------------------------
*/
const updatePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return sendBadRequestResponse(res, 'Current password and new password required');
    }

    const passwordErrors = validatePassword(newPassword);
    if (passwordErrors.length > 0) {
      return sendBadRequestResponse(res, passwordErrors[0]);
    }

    const user = await User.findById(req.user.userId).select('+password');

    if (!user) {
      return sendNotFoundResponse(res, 'User not found');
    }

    const isPasswordCorrect = await user.comparePassword(currentPassword);
    if (!isPasswordCorrect) {
      return sendBadRequestResponse(res, 'Current password is incorrect');
    }

    user.password = newPassword;
    await user.save();

    return sendSuccessResponseData(res, 'Password updated successfully', null);
  } catch (error) {
    console.error('Update password error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| GET CURRENT USER
|--------------------------------------------------------------------------
*/
const getCurrentUser = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return sendNotFoundResponse(res, 'User not found');
    }

    const safeUser = sanitizeUser(user);
    return sendSuccessResponseData(res, 'User retrieved successfully', { user: safeUser });
  } catch (error) {
    console.error('Get current user error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| GET ALL USERS (admin)
|--------------------------------------------------------------------------
*/
const getAllUsers = async (req, res) => {
  try {
    const admin = await User.findById(req.user.userId).select('role');
    if (!admin) return sendUnauthenticatedErrorResponse(res, 'User not found');
    if (admin.role !== 'admin') return sendUnauthenticatedErrorResponse(res, 'Admin access required');

    const users = await User.find()
      .select('-password -resetPasswordToken -resetPasswordExpire -pin')
      .sort({ createdAt: -1 });

    return sendSuccessResponseData(res, 'Users retrieved successfully', {
      users,
      total: users.length
    });
  } catch (error) {
    console.error('Get all users error:', error);
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

/*
|--------------------------------------------------------------------------
| LOGOUT (client-side token removal, optional blacklist)
|--------------------------------------------------------------------------
*/
const logout = async (req, res) => {
  try {
    // If you use refresh tokens stored in DB, clear them here.
    // Optionally blacklist the current JWT until expiry.
    return sendSuccessResponseData(res, 'Logged out successfully', null);
  } catch (error) {
    return sendUnauthenticatedErrorResponse(res, error.message);
  }
};

module.exports = {
  register,
  verifyOTP,
  resendOTP,
  login,
  refreshToken,
  logout,
  forgotPassword,
  resetPassword,
  updatePassword,
  getCurrentUser,
  getAllUsers,
};