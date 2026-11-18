'use strict';
// Real commerce schema for isolated PGlite tests. The only stand-ins are the
// network/scheduler facilities, which financial fixtures never invoke.
const fs=require('node:fs'),path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'../../supabase/migrations',name),'utf8');
async function base(db){
 await db.exec('create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create schema commerce_internal;');
 for(const file of [
  '20261110040926_manual_invoice_commerce.sql','20261110074742_payment_provider_options.sql','20261110164316_native_gateway_checkout.sql',
  '20261111013606_peptidepay_invoice_sessions.sql','20261111025932_direct_checkout_balances.sql','20261111163930_conversion_memberships_partners.sql',
  '20261111174353_partner_settings_supplier_queue.sql','20261111195957_unified_supplier_fulfillment.sql','20261111210000_single_supplier_per_order.sql',
  '20261112211215_rampex_order_payment_mapping.sql','20261112221052_rampex_multi_hosted.sql','20261113003946_rampex_stripe_only.sql',
  '20261113030240_safe_checkout_cancellation.sql','20261114211235_platinum_membership_benefits.sql','20261115090000_research_subscriptions.sql',
  '20261116140000_unified_order_management.sql','20261116150000_purity_manual_fulfillment.sql'
 ])await db.exec(read(file));
}
async function polygon(db){
 await db.exec("create schema cron;create table cron.job(jobname text primary key,schedule text,command text);create function cron.schedule(text,text,text) returns bigint language plpgsql as $$begin insert into cron.job values($1,$2,$3) on conflict(jobname) do update set schedule=$2,command=$3;return 1;end$$;create schema vault;create table vault.decrypted_secrets(name text,decrypted_secret text);create schema extensions;create function extensions.hmac(bytea,bytea,text) returns bytea language sql as $$select decode(repeat('a',64),'hex')$$;create schema net;create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as $$select 1::bigint$$;");
 await db.exec(read('20261117193534_pure_direct_polygon_usdc.sql'));
 await db.exec(read('20261117221400_pure_crypto_cancellation_requests.sql'));
}
module.exports={base,polygon,read};
