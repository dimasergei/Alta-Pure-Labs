'use strict';

/**
 * Public, read-only checkout status. Reveals no credentials or configuration
 * details beyond whether the existing server-side checkout gate is enabled.
 * Any missing/unknown value is treated as unavailable.
 */
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Use GET.' });
  }
  return res.status(200).json({
    enabled: process.env.CHECKOUT_ENABLED === 'true'
  });
};
