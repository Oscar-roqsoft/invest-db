// utils/emailUtils.js
const { Resend } = require('resend');
const cache = require('../db/cache');
const { generateOTP } = require('./authUtils');

// Initialize Resend client (lazy to allow env to load first)
let resendClient = null;

const getResend = () => {
  if (!resendClient) {
    if (!process.env.RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY is not set in environment variables');
    }
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }
  return resendClient;
};

// From address
const FROM_ADDRESS = () =>
  `${process.env.APP_NAME || 'CoinSquare Wealth'} <${
    process.env.EMAIL_FROM || 'onboarding@resend.dev'
  }>`;

// ─────────────────────────────────────────────────────────────
// HTML EMAIL TEMPLATE
// ─────────────────────────────────────────────────────────────
const emailTemplate = (title, body, ctaText = null, ctaUrl = null) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: 'Segoe UI', Arial, sans-serif; background: #f4f4f7; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 40px auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.06); }
    .header { background: linear-gradient(135deg, #020862, #000832); padding: 32px; text-align: center; }
    .header h1 { color: #F5D77F; margin: 0; font-size: 24px; letter-spacing: 1px; }
    .body { padding: 40px 32px; color: #333; line-height: 1.6; }
    .body h2 { color: #020862; margin-top: 0; }
    .otp-box { background: #faf7f0; border: 2px dashed #BB914A; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0; }
    .otp-code { font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #020862; }
    .cta { display: inline-block; background: linear-gradient(135deg, #F5D77F, #E6BB5C); color: #020862 !important; padding: 14px 32px; border-radius: 10px; text-decoration: none; font-weight: bold; margin: 20px 0; }
    .footer { background: #f4f4f7; padding: 20px; text-align: center; color: #999; font-size: 12px; }
    ul { padding-left: 20px; }
    .info-row { margin: 4px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header"><h1>CoinSquare Wealth</h1></div>
    <div class="body">
      <h2>${title}</h2>
      ${body}
      ${
        ctaText && ctaUrl
          ? `<div style="text-align: center;"><a href="${ctaUrl}" class="cta">${ctaText}</a></div>`
          : ''
      }
    </div>
    <div class="footer">
      © ${new Date().getFullYear()} CoinSquare Wealth. All rights reserved.<br>
      This is an automated message, please do not reply.
    </div>
  </div>
</body>
</html>
`;

// ─────────────────────────────────────────────────────────────
// CORE SEND HELPER
// ─────────────────────────────────────────────────────────────
const sendEmail = async ({ to, subject, html, replyTo = null }) => {
  try {
    const resend = getResend();

    const payload = {
      from: FROM_ADDRESS(),
      to,
      subject,
      html,
    };

    if (replyTo || process.env.EMAIL_REPLY_TO) {
      payload.reply_to = replyTo || process.env.EMAIL_REPLY_TO;
    }

    const { data, error } = await resend.emails.send(payload);

    if (error) {
      // Resend returns { error: { name, message } } on failure
      console.error('❌ Resend API error:', error.name, '-', error.message);
      throw new Error(error.message || 'Failed to send email');
    }

    // In development, log the email ID
    if (process.env.NODE_ENV !== 'production') {
      console.log(`📧 Email sent via Resend [id: ${data?.id}] to ${to}`);
    }

    return { success: true, id: data?.id };
  } catch (error) {
    console.error('Send email error:', error.message);
    throw error;
  }
};

// ─────────────────────────────────────────────────────────────
// SEND OTP EMAIL
// ─────────────────────────────────────────────────────────────
const sendOTPEmail = async (user, token = null) => {
  try {
    const otp = generateOTP();
    const cacheKey = `otp:${user.email.toLowerCase().trim()}`;
    cache.set(cacheKey, otp, 600); // 10 minutes

    // Dev mode: log the OTP so you can test without checking email
    if (process.env.NODE_ENV !== 'production') {
      console.log(`🔐 [DEV] OTP for ${user.email}: ${otp}`);
    }

    const body = `
      <p>Hi ${user.name},</p>
      <p>Welcome to CoinSquare Wealth! Use the verification code below to complete your registration:</p>
      <div class="otp-box">
        <div class="otp-code">${otp}</div>
        <p style="margin: 8px 0 0; color: #888; font-size: 13px;">Valid for 10 minutes</p>
      </div>
      <p>If you didn't create an account with us, please ignore this email.</p>
    `;

    await sendEmail({
      to: user.email,
      subject: 'Your Verification Code - CoinSquare Wealth',
      html: emailTemplate('Verify Your Email', body),
    });

    return true;
  } catch (error) {
    console.error('Send OTP email error:', error.message);
    throw error;
  }
};

// ─────────────────────────────────────────────────────────────
// SEND WELCOME EMAIL
// ─────────────────────────────────────────────────────────────
const sendWelcomeEmail = async (user) => {
  try {
    const body = `
      <p>Hi ${user.name},</p>
      <p>Your account has been successfully verified! We're excited to have you on board.</p>
      <p>Here's what you can do next:</p>
      <ul>
        <li>Fund your account with crypto</li>
        <li>Choose an investment plan</li>
        <li>Earn daily returns</li>
        <li>Refer friends and earn 5% commission</li>
      </ul>
    `;

    await sendEmail({
      to: user.email,
      subject: 'Welcome to CoinSquare Wealth!',
      html: emailTemplate(
        'Welcome Aboard 🎉',
        body,
        'Go to Dashboard',
        `${process.env.APP_URL}/dashboard`
      ),
    });

    return true;
  } catch (error) {
    console.error('Send welcome email error:', error.message);
    throw error;
  }
};

// ─────────────────────────────────────────────────────────────
// SEND PASSWORD RESET EMAIL
// ─────────────────────────────────────────────────────────────
const sendPasswordResetEmail = async (user, resetToken) => {
  try {
    const resetUrl = `${process.env.APP_URL}/reset-password?token=${resetToken}`;

    const body = `
      <p>Hi ${user.name},</p>
      <p>We received a request to reset your password. Click the button below to set a new password:</p>
      <p style="color: #888; font-size: 13px;">This link expires in 1 hour.</p>
      <p>If you didn't request a password reset, please ignore this email or contact support.</p>
    `;

    await sendEmail({
      to: user.email,
      subject: 'Password Reset Request - CoinSquare Wealth',
      html: emailTemplate('Reset Your Password', body, 'Reset Password', resetUrl),
    });

    return true;
  } catch (error) {
    console.error('Send password reset email error:', error.message);
    throw error;
  }
};

// ─────────────────────────────────────────────────────────────
// SEND TRANSACTION NOTIFICATION
// ─────────────────────────────────────────────────────────────
const sendTransactionEmail = async (user, { type, amount, crypto, status, reference }) => {
  try {
    const body = `
      <p>Hi ${user.name},</p>
      <p>Your ${type} has been ${String(status).toLowerCase()}:</p>
      <div class="otp-box" style="text-align: left;">
        <p class="info-row"><strong>Amount:</strong> ${amount} ${crypto}</p>
        <p class="info-row"><strong>Status:</strong> ${status}</p>
        <p class="info-row"><strong>Reference:</strong> ${reference}</p>
      </div>
    `;

    await sendEmail({
      to: user.email,
      subject: `${type} ${status} - CoinSquare Wealth`,
      html: emailTemplate(`${type} ${status}`, body),
    });

    return true;
  } catch (error) {
    console.error('Send transaction email error:', error.message);
    throw error;
  }
};

// ─────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────
module.exports = {
  sendEmail,
  sendOTPEmail,
  sendWelcomeEmail,
  sendPasswordResetEmail,
  sendTransactionEmail,
};