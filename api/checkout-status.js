'use strict';

/**
 * The legacy Stripe checkout is retired. This public endpoint is deliberately
 * independent of CHECKOUT_ENABLED and other stale Vercel environment flags.
 * A new provider-specific launch requires a separately reviewed implementation.
 */
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Use GET.' });
  }
  return res.status(200).json({ enabled: false });
};
