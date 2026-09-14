// app.js
const express = require("express");
const app = express();
require("dotenv").config();
const cors = require("cors");
const bodyParser = require("body-parser");
const rateLimiter = require('express-rate-limit');
const xss = require('xss-clean');
const path = require('path');
const connectDB = require('./db/mongodb');

const { startInvestmentPayoutJob } = require('./jobs/investmentPayout');
// Routes (v1)

const authRoutes = require("./api/v1/routes/auth");
const walletRoutes = require("./api/v1/routes/wallet");
const depositRoutes = require("./api/v1/routes/deposit");
const withdrawalRoutes = require("./api/v1/routes/withdrawal");
const investmentRoutes = require("./api/v1/routes/investment");
const transactionRoutes = require("./api/v1/routes/transaction");
const referralRoutes = require("./api/v1/routes/referral");
const adminRoutes = require("./api/v1/routes/admin");
const userRoutes = require("./api/v1/routes/user");


const uploadRoutes = require("./api/v1/routes/uploadRoute");


// Middlewares
const notFound = require('./middlewares/not-found');
const errorHandlers = require('./middlewares/errors');

const port = process.env.PORT || 5000;

// Body parser middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// CORS
app.use((req, res, next) => {
    res.setHeader(
      "Access-Control-Allow-Origin",
      "*",
      'http://localhost:5000',
      'http://localhost:3000'
    );
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH");
    res.header(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, token"
    );
    next();
});

app.use(cors({
  allowedHeaders: ["Content-Type", "Authorization", "token"],
  origin: "*"
}));

// app.use(xss());
// app.use(rateLimiter({
//   windowMs: 15 * 60 * 1000,
//   max: 100
// }));

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
// ─────────────────────────────────────────────────────────────
// ROUTES (v1)
// ─────────────────────────────────────────────────────────────
app.use("/api/v1/upload", uploadRoutes);
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/wallet", walletRoutes);
app.use("/api/v1/deposit", depositRoutes);
app.use("/api/v1/withdrawal", withdrawalRoutes);
app.use("/api/v1/investment", investmentRoutes);
app.use("/api/v1/transaction", transactionRoutes);
app.use("/api/v1/referral", referralRoutes);
app.use("/api/v1/admin", adminRoutes);
app.use("/api/v1/user", userRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'CoinSquare Wealth API is running',
    timestamp: new Date().toISOString(),
    mongodb: process.env.MONGO_URI ? 'Configured' : 'Not configured'
  });
});

// Error handling
app.use(notFound);
app.use(errorHandlers);

// Start server
const startServer = async () => {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error("MONGO_URI is not defined in the environment variables.");
    }

    console.log('🔍 Environment Check:');
    console.log('  MONGO_URI:', process.env.MONGO_URI ? '✅ Set' : '❌ Not set');
    console.log('  RESEND_API_KEY:', process.env.RESEND_API_KEY ? '✅ Set' : '❌ Not set');
    console.log('  JWT_SECRET:', process.env.JWT_SECRET ? '✅ Set' : '❌ Not set');

    await connectDB(process.env.MONGO_URI);

    app.listen(port, () => {
      console.log(`🚀 Server running on port ${port}`);
      console.log('📋 Available Routes:');
      console.log('  ✅ Auth:          /api/v1/auth');
      console.log('  ✅ Wallet:        /api/v1/wallet');
      console.log('  ✅ Deposit:       /api/v1/deposit');
      console.log('  ✅ Withdrawal:    /api/v1/withdrawal');
      console.log('  ✅ Investment:    /api/v1/investment');
      console.log('  ✅ Transaction:   /api/v1/transaction');
      console.log('  ✅ Referral:      /api/v1/referral');
      console.log('  ✅ Admin:         /api/v1/admin');
    });
  } catch (err) {
    console.error("❌ Failed to start server:", err.message);
    process.exit(1);
  }
};

startServer();