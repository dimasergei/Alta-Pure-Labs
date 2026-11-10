'use strict';

/**
 * NEW STRIPE CHECKOUT IS RETIRED.
 *
 * This endpoint deliberately fails closed, regardless of Vercel environment
 * variables, while AltaPure transitions to an underwritten payment provider.
 * Keeping the legacy Stripe webhook separately allows historical payment
 * events, refunds, disputes and reconciliation to remain intact.
 *
 * Do not add a bypass flag. A replacement checkout must be independently
 * reviewed, enforce SKU/destination/payment-rail eligibility server-side,
 * and use a newly approved provider's signed webhooks.
 */
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use POST.' });
  }

  return res.status(503).json({
    error: 'Online checkout is temporarily unavailable while payment options are updated.'
  });
};
