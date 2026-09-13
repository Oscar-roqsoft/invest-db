// utils/authUtils.js
const crypto = require('crypto');

// Generate random OTP (6 digits)
const generateOTP = () => {
  return crypto.randomInt(100000, 999999).toString();
};

// Generate wallet address (for user's internal wallet)
const generateWalletAddress = () => {
  return '0x' + crypto.randomBytes(20).toString('hex');
};

// Validate email format
const validateEmail = (email) => {
  const re = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/;
  return re.test(String(email).toLowerCase());
};

// Validate password strength — returns array of error messages
const validatePassword = (password) => {
  const errors = [];

  if (!password || password.length < 8) {
    errors.push('Password must be at least 8 characters');
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain an uppercase letter');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain a lowercase letter');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain a number');
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    errors.push('Password must contain a special character');
  }

  return errors;
};

// Sanitize user object (remove sensitive fields)
const sanitizeUser = (user) => {
  if (!user) return null;
  const obj = user.toObject ? user.toObject() : { ...user };
  delete obj.password;
  delete obj.pin;
  delete obj.resetPasswordToken;
  delete obj.resetPasswordExpire;
  delete obj.__v;
  return obj;
};

// Generate a unique reference ID
const generateReference = (prefix = 'TXN') => {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `${prefix}-${timestamp}-${random}`;
};

// Hash token with SHA256
const hashToken = (token) => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

module.exports = {
  generateOTP,
  generateWalletAddress,
  validateEmail,
  validatePassword,
  sanitizeUser,
  generateReference,
  hashToken,
};