'use strict';

const config = require('../config/display-currencies.json');
const fx = require('./display-fx');
const countries = new Set(config.country_codes.split(' '));

function country(req) {
  // This is only a presentation hint from Vercel's ingress. It must never be
  // used as a shipping address, payment-country check or authorization signal.
  const header = req.headers?.['x-vercel-ip-country'];
  const code = typeof header === 'string' && /^[A-Za-z]{2}$/.test(header) ? header.toUpperCase() : null;
  const knownCountry = countries.has(code) ? code : null;
  return {
    version: 'display-locale-v1', base: 'USD', country: knownCountry,
    suggested_currency: config.country_currencies[knownCountry] || 'USD',
    supported_currencies: [...fx.SUPPORTED_CURRENCIES]
  };
}

async function handle(req, res, params, deps = {}) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({error: 'Display currency supports GET requests only.'});
  }
  if (params.getAll('display_locale').length !== 1 || [...params.keys()].some(key => key !== 'display_locale')) {
    return res.status(400).json({error: 'Invalid display-currency request.'});
  }
  const action = params.get('display_locale');
  if (action === 'country') return res.status(200).json(country(req));
  if (action !== 'rates') return res.status(400).json({error: 'Invalid display-currency request.'});
  // Request headers, account identity and country are deliberately not passed
  // to the rate provider; this response is identical for every customer.
  const result = await fx.load({fetchImpl: deps.fetchImpl, now: deps.now});
  res.setHeader('Cache-Control', fx.cacheControl(result, deps.now));
  return res.status(200).json(result);
}

module.exports = {handle, country};
