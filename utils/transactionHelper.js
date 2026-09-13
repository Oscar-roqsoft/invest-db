// utils/transactionHelper.js
const Transaction = require('../api/v1/models/transaction');
const { generateReference } = require('./authUtils');

// Direction by type
const DIRECTION_MAP = {
  deposit: 'credit',
  withdrawal: 'debit',
  investment: 'debit',
  earning: 'credit',
  referral: 'credit',
  refund: 'credit',
  bonus: 'credit',
};

/*
|--------------------------------------------------------------------------
| CREATE TRANSACTION
|--------------------------------------------------------------------------
| Usage in any handler:
|   await createTransaction({
|     user: userId,
|     type: 'deposit',
|     currency: 'BTC',
|     amount: 500,
|     amountCrypto: 0.007416,
|     status: 'pending',
|     reference: 'DEP-XXXX',
|     relatedId: deposit._id,
|     relatedModel: 'Deposit',
|     description: 'Deposit of 0.007416 BTC',
|   });
|--------------------------------------------------------------------------
*/
const createTransaction = async (data) => {
  const {
    user,
    type,
    currency,
    amount,
    amountCrypto = 0,
    status = 'pending',
    reference,
    relatedId,
    relatedModel,
    description = '',
    metadata = {},
    balanceAfter = 0,
  } = data;

  if (!user || !type || !amount) {
    throw new Error('createTransaction: user, type, and amount are required');
  }

  const direction = DIRECTION_MAP[type] || 'credit';

  const transaction = await Transaction.create({
    user,
    type,
    direction,
    currency: currency || 'USD',
    amount,
    amountCrypto,
    balanceAfter,
    status,
    reference: reference || generateReference(type.substring(0, 3).toUpperCase()),
    relatedId,
    relatedModel,
    description,
    metadata,
    completedAt: status === 'completed' ? new Date() : undefined,
  });

  return transaction;
};

/*
|--------------------------------------------------------------------------
| UPDATE TRANSACTION STATUS
|--------------------------------------------------------------------------
*/
const updateTransactionStatus = async (relatedId, relatedModel, status, extra = {}) => {
  return await Transaction.findOneAndUpdate(
    { relatedId, relatedModel },
    {
      status,
      ...extra,
      ...(status === 'completed' ? { completedAt: new Date() } : {}),
    },
    { new: true }
  );
};

module.exports = {
  createTransaction,
  updateTransactionStatus,
  DIRECTION_MAP,
};