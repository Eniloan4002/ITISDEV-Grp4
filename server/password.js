// Password hashing — Node's built-in `crypto` scrypt (no npm install).
//
// Stored form is a single string "salt:hash" (both hex). scrypt is a slow,
// memory-hard KDF, so this resists brute-force without any external library.

const crypto = require('crypto');

// hashPassword(plain) -> "salt:hash" (hex:hex)
function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(plain, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

// verifyPassword(attempt, stored) -> boolean. Timing-safe comparison.
function verifyPassword(attempt, stored) {
  if (typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, key] = stored.split(':');
  const calc = crypto.scryptSync(attempt, salt, 64).toString('hex');
  const keyBuf = Buffer.from(key, 'hex');
  const calcBuf = Buffer.from(calc, 'hex');
  if (keyBuf.length !== calcBuf.length) return false;
  return crypto.timingSafeEqual(keyBuf, calcBuf);
}

module.exports = { hashPassword, verifyPassword };
