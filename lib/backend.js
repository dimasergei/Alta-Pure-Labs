const {createClient} = require('@supabase/supabase-js');
const Stripe = require('stripe');
function clients() {
  const key = process.env.STRIPE_SECRET_KEY || '';
  if (!key.startsWith('sk_test_')) throw new Error('This build accepts Stripe TEST keys only.');
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing Supabase settings.');
  return {
    stripe: new Stripe(key, {apiVersion:'2025-03-31.basil', maxNetworkRetries:2}),
    db: createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false, autoRefreshToken:false}})
  };
}
function checked(result) { if (result.error) throw result.error; return result.data; }
module.exports = {clients, checked};
