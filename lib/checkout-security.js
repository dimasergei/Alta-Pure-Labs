const { createHmac } = require('node:crypto');

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function configuredOrigin(value) {
  let url;

  try {
    url = new URL(value);
  } catch {
    throw new Error('SITE_URL must be an HTTPS origin.');
  }

  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('SITE_URL must be an HTTPS origin.');
  }

  return url.origin;
}

function parseBody(body) {
  const raw =
    typeof body === 'string'
      ? body
      : JSON.stringify(body);

  if (typeof raw !== 'string') {
    throw httpError(400, 'JSON body required.');
  }

  if (Buffer.byteLength(raw, 'utf8') > 32768) {
    throw httpError(413, 'Checkout request too large.');
  }

  let parsed;

  try {
    parsed =
      typeof body === 'string'
        ? JSON.parse(body)
        : body;
  } catch {
    throw httpError(400, 'Invalid JSON.');
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed)
  ) {
    throw httpError(400, 'Invalid checkout request.');
  }

  return parsed;
}

function rateKey(email, secret) {
  if (
    typeof secret !== 'string' ||
    secret.length < 32
  ) {
    throw new Error(
      'Set CHECKOUT_RATE_LIMIT_SECRET to at least 32 random characters.'
    );
  }

  return createHmac('sha256', secret)
    .update(String(email).trim().toLowerCase())
    .digest('hex');
}

async function enforceRateLimit(db, email, secret) {
  const { data, error } = await db.rpc(
    'consume_store_checkout_limit',
    {
      p_key: rateKey(email, secret)
    }
  );

  if (error) {
    throw new Error('Checkout rate limiter unavailable.');
  }

  if (data !== true) {
    throw httpError(
      429,
      'Too many checkout attempts. Please try again later.'
    );
  }
}

module.exports = {
  configuredOrigin,
  parseBody,
  rateKey,
  enforceRateLimit
};
