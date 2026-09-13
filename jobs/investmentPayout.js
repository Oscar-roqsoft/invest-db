// jobs/investmentPayout.js
const cron = require('node-cron');
const mongoose = require('mongoose');
const Investment = require('../api/v1/models/investment');
const InvestmentEarning = require('../api/v1/models/investmentEarning');
const User = require('../api/v1/models/user');
const Transaction = require('../api/v1/models/transaction');
const { generateReference } = require('../utils/authUtils');

const DAY_MS = 24 * 60 * 60 * 1000;

/*
|--------------------------------------------------------------------------
| PROCESS ONE INVESTMENT PAYOUT
|--------------------------------------------------------------------------
*/
const processPayout = async (investment) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const fresh = await Investment.findById(investment._id).session(session);
    if (!fresh || fresh.status !== 'active') {
      await session.abortTransaction();
      return { skipped: true };
    }

    const day = fresh.daysCompleted + 1;
    const earning = fresh.dailyEarning;

    // Prevent double payout
    const alreadyPaid = await InvestmentEarning.findOne({
      investment: fresh._id,
      day,
    }).session(session);

    if (alreadyPaid) {
      await session.abortTransaction();
      return { skipped: true, reason: 'already_paid' };
    }

    // Record earning
    await InvestmentEarning.create(
      [
        {
          investment: fresh._id,
          user: fresh.user,
          amount: earning,
          day,
          paidAt: new Date(),
        },
      ],
      { session }
    );

    // Credit user
    await User.findByIdAndUpdate(
      fresh.user,
      {
        $inc: {
          'balances.USD': earning,
          totalEarnings: earning,
        },
      },
      { session }
    );

    // Transaction record
    await Transaction.create(
      [
        {
          user: fresh.user,
          type: 'earning',
          currency: 'USD',
          amount: earning,
          amountCrypto: 0,
          status: 'completed',
          reference: generateReference('ERN'),
          relatedId: fresh._id,
          relatedModel: 'Investment',
          description: `Daily earning from ${fresh.planName} (Day ${day})`,
        },
      ],
      { session }
    );

    // Update investment
    fresh.earned = parseFloat((fresh.earned + earning).toFixed(2));
    fresh.daysCompleted = day;
    fresh.lastPayoutAt = new Date();
    fresh.nextPayoutAt = new Date(Date.now() + DAY_MS);

    // Mark completed if last day
    if (day >= fresh.duration) {
      fresh.status = 'completed';
      fresh.completedAt = new Date();
      fresh.earningsPaid = true;

      // Return principal
      if (!fresh.principalReturned) {
        await User.findByIdAndUpdate(
          fresh.user,
          {
            $inc: {
              'balances.USD': fresh.amount,
            },
          },
          { session }
        );

        await Transaction.create(
          [
            {
              user: fresh.user,
              type: 'refund',
              currency: 'USD',
              amount: fresh.amount,
              amountCrypto: 0,
              status: 'completed',
              reference: generateReference('PRN'),
              relatedId: fresh._id,
              relatedModel: 'Investment',
              description: `Principal returned from ${fresh.planName}`,
            },
          ],
          { session }
        );

        fresh.principalReturned = true;
      }
    }

    await fresh.save({ session });

    await session.commitTransaction();
    return { success: true, earning, day, investmentId: fresh._id };
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
};

/*
|--------------------------------------------------------------------------
| RUN PAYOUTS FOR ALL DUE INVESTMENTS
|--------------------------------------------------------------------------
*/
const runPayouts = async () => {
  try {
    const now = new Date();

    // Find all active investments where next payout has come
    const dueInvestments = await Investment.find({
      status: 'active',
      nextPayoutAt: { $lte: now },
    }).limit(500); // Process in batches

    if (dueInvestments.length === 0) {
      return;
    }

    console.log(`💰 Processing ${dueInvestments.length} investment payouts...`);

    let success = 0;
    let failed = 0;

    for (const inv of dueInvestments) {
      try {
        const result = await processPayout(inv);
        if (result.success) success++;
      } catch (err) {
        failed++;
        console.error(`❌ Payout failed for ${inv._id}:`, err.message);
      }
    }

    console.log(`✅ Payouts: ${success} success, ${failed} failed`);
  } catch (err) {
    console.error('❌ Investment payout job error:', err.message);
  }
};

/*
|--------------------------------------------------------------------------
| START CRON
|--------------------------------------------------------------------------
| Runs every hour. Investments that are due get processed.
| This ensures late jobs are caught up.
|--------------------------------------------------------------------------
*/
const startInvestmentPayoutJob = () => {
  // Run every hour
  cron.schedule('0 * * * *', runPayouts);

  // Also run once on startup (after 30s) to catch anything missed
  setTimeout(runPayouts, 30 * 1000);

  console.log('💵 Investment payout job started (every hour)');
};

module.exports = {
  startInvestmentPayoutJob,
  runPayouts,
  processPayout,
};