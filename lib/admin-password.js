'use strict';

const { randomBytes, scrypt, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');

const derive = promisify(scrypt);
// A fixed, versioned work factor. Hash contents cannot request arbitrary CPU or memory.
const COST = Object.freeze({ N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 });
const ENCODED = /^scrypt-v1\$([a-f0-9]{32})\$([a-f0-9]{128})$/;

function validatePassword(value) {
  if (typeof value !== 'string' || [...value].length < 12 || [...value].length > 128 || Buffer.byteLength(value, 'utf8') > 512) {
    const error = new Error('Use a password with 12 to 128 characters.'); error.status = 400; throw error;
  }
  return value;
}

async function hashPassword(value) {
  validatePassword(value);
  const salt = randomBytes(16).toString('hex');
  const result = await derive(value, Buffer.from(salt, 'hex'), 64, COST);
  return `scrypt-v1$${salt}$${result.toString('hex')}`;
}

async function verifyPassword(value, encoded) {
  if (typeof value !== 'string' || [...value].length > 128 || Buffer.byteLength(value, 'utf8') > 512) return false;
  const match = typeof encoded === 'string' ? ENCODED.exec(encoded) : null;
  // Keep the same expensive work when a password has not been configured yet.
  const salt = Buffer.from(match ? match[1] : '00'.repeat(16), 'hex');
  const expected = Buffer.from(match ? match[2] : '00'.repeat(64), 'hex');
  const actual = await derive(value, salt, 64, COST);
  return timingSafeEqual(actual, expected) && Boolean(match);
}

module.exports = { hashPassword, verifyPassword, validatePassword };
