'use strict';
const { createClient } = require('@supabase/supabase-js');
function inventoryDb() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)
    throw new Error('Inventory database unavailable.');
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } });
}
module.exports = { inventoryDb };
