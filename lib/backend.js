const {createClient} = require('@supabase/supabase-js');
const Stripe = require('stripe');

function databaseClient() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing Supabase settings.');
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false, autoRefreshToken:false}});
}
function paymentClient() {
  const key = process.env.STRIPE_SECRET_KEY || '';
  const liveCheckoutEnabled = process.env.LIVE_CHECKOUT_ENABLED === 'true';
  if (liveCheckoutEnabled) {
    if (!key.startsWith('sk_live_')) throw new Error('Live checkout is enabled, but STRIPE_SECRET_KEY is not a valid Stripe live secret key.');
  } else if (!key.startsWith('sk_test_')) {
    throw new Error('This build accepts Stripe TEST keys only.');
  }
  return new Stripe(key, {apiVersion:'2026-10-28.endive', maxNetworkRetries:2});
}
function clients() {
  const db=databaseClient();
  let stripe;
  // DB-only customer/admin operations must not depend on a retired payment rail.
  // Historical payment handlers still receive the same validated Stripe client.
  return {db,get stripe(){if(!stripe)stripe=paymentClient();return stripe;}};
}
function checked(result) { if (result.error) throw result.error; return result.data; }
module.exports = {clients, checked, databaseClient};
