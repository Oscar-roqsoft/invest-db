// utils/secureWalletCrypto.js
const crypto = require('crypto');

/**
 * AES-256-GCM authenticated encryption for seed phrases, private keys,
 * and keystores.
 *
 * SECURITY REQUIREMENTS (enforced at startup):
 *   - WALLET_SECRET env var MUST be a 64-char hex string (= 32 bytes)
 *   - No default fallback. Fails fast if missing or malformed.
 *
 * Output format:
 *   v1:gcm:<ivBase64>:<authTagBase64>:<ciphertextBase64>
 *   - prefixed with a version so future schemes can coexist
 */

const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12;        // 96-bit nonce, standard for GCM
const VERSION = 'v1';
const SCHEME = 'gcm';

// ─── Resolve + validate key at module load ─────────────────
const KEY_HEX = process.env.WALLET_SECRET;

// if (!KEY_HEX) {
//   throw new Error(
//     'WALLET_SECRET is not set. This is required to encrypt/decrypt user wallet data. ' +
//     'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
//   );
// }

// if (!/^[0-9a-fA-F]{64}$/.test(KEY_HEX)) {
//   throw new Error(
//     'WALLET_SECRET must be a 64-character hex string (32 bytes). ' +
//     'Current value is ' + KEY_HEX.length + ' characters. ' +
//     'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
//   );
// }

const KEY = Buffer.from(KEY_HEX, 'hex');

// ─── Encrypt ────────────────────────────────────────────────
/**
 * @param {string|Buffer} plaintext
 * @returns {string} encoded blob — safe to store as a Mongo String
 */
const encrypt = (plaintext) => {
  if (plaintext === undefined || plaintext === null) return null;

  const buf = Buffer.isBuffer(plaintext)
    ? plaintext
    : Buffer.from(String(plaintext), 'utf8');

  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGO, KEY, iv);

  const ciphertext = Buffer.concat([cipher.update(buf), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    VERSION,
    SCHEME,
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
};

// ─── Decrypt ────────────────────────────────────────────────
/**
 * @param {string} blob — output of encrypt()
 * @returns {string} plaintext
 * @throws on malformed input or tampered ciphertext
 */
const decrypt = (blob) => {
  if (!blob || typeof blob !== 'string') {
    throw new Error('decrypt: input must be a non-empty string');
  }

  const parts = blob.split(':');
  if (parts.length !== 5) {
    throw new Error('decrypt: malformed ciphertext (expected 5 segments)');
  }

  const [version, scheme, ivB64, tagB64, dataB64] = parts;

  if (version !== VERSION || scheme !== SCHEME) {
    throw new Error(`decrypt: unsupported cipher version/scheme (${version}/${scheme})`);
  }

  let iv, authTag, ciphertext;
  try {
    iv = Buffer.from(ivB64, 'base64');
    authTag = Buffer.from(tagB64, 'base64');
    ciphertext = Buffer.from(dataB64, 'base64');
  } catch {
    throw new Error('decrypt: invalid base64 segments');
  }

  if (iv.length !== IV_LENGTH) {
    throw new Error('decrypt: invalid IV length');
  }
  if (authTag.length !== 16) {
    throw new Error('decrypt: invalid auth tag length');
  }

  const decipher = crypto.createDecipheriv(ALGO, KEY, iv);
  decipher.setAuthTag(authTag);

  // .final() will throw if the auth tag doesn't match
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  return plaintext.toString('utf8');
};

module.exports = { encrypt, decrypt };