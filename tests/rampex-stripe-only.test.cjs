'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs');
const r=require('../lib/rampex');
const env={RAMPEX_API_KEY:'offline-fixture-api-key'};
const id='10000000-0000-4000-8000-000000000001';
const invoice='20000000-0000-4000-8000-000000000001';
const attempt={id,invoice_id:invoice,provider:'rampex',mode:'live',rampex_provider:'stripe',rampex_link_id:'stripe-fixture-link-100',amount_cents:4900,currency:'USD'};
const completed={link_id:attempt.rampex_link_id,status:'completed',amount:49,received_amount:49,currency:'USD',
 paid_at:'2026-11-13T00:00:00Z',transaction_hash:'0x'+'a'.repeat(64),payout_amount:47.5,payout_currency:'USDC',provider:'stripe'};
const event={event:'payment.completed',link_id:attempt.rampex_link_id,status:'completed',amount:49,received_amount:49,currency:'USD',metadata:{order_id:id},
 payout_network:'polygon',txid_out:'0x'+'b'.repeat(64),payout_currency:'USDC',provider:'stripe'};
const response=data=>new Response(JSON.stringify({success:true,data}),{status:200});
test('Rampex Stripe is the explicit card provider, old hosted attempts remain interpretable',()=>{
 assert.equal(r.assertRail('stripe'),'stripe');
 assert.equal(r.assertRail('hosted'),'hosted');
 for(const bad of ['Stripe','stripe;hosted','creditcard','paypal',null])assert.throws(()=>r.assertRail(bad));
});
test('Stripe-only provider has a live USD minimum and does not fall back to hosted',async()=>{
 const active={id:'stripe',status:'active',minimum_currency:'USD',minimum_amount:2};
 assert.equal((await r.providerStatus('stripe',4900,async()=>response({providers:[active,{...active,id:'hosted'}]}))).id,'stripe');
 for(const patch of [{status:'redirected'}, {status:'inactive'}, {minimum_currency:'EUR'}, {minimum_amount:50}, {id:'hosted'}]){
   await assert.rejects(()=>r.providerStatus('stripe',4900,async()=>response({providers:[{...active,...patch}]})));
 }
});
test('Stripe-only link preserves exact amount, server attempt id, and verified checkout URL',async()=>{
 let calls=0;
 const result=await r.create(attempt,'buyer@example.test',env,async(url,opts)=>{
   calls++; assert.equal(url,'https://api.rampex.io/api-create-payment-link');
   const body=JSON.parse(opts.body);
   assert.equal(body.provider,'stripe');
   assert.equal(body.amount,49);
   assert.equal(body.woo_order_id,id);
   assert.equal(opts.headers['X-API-Key'],env.RAMPEX_API_KEY);
   assert.equal(opts.redirect,'error');
   return response({link_id:attempt.rampex_link_id,amount:49,currency:'USD',status:'active',customer_email:'buyer@example.test',
     provider:'stripe',redirect_url:'https://checkout.rampex.io/process-payment.php?provider=stripe&ref=fixture'});
 });
 assert.equal(calls,1);
 assert.ok(result.url.startsWith('https://checkout.rampex.io/'));
 for(const provider of ['hosted','googlepay','applepay','rampnetwork']){
   await assert.rejects(()=>r.create(attempt,'buyer@example.test',env,async()=>response({
    link_id:attempt.rampex_link_id,amount:49,currency:'USD',status:'active',customer_email:'buyer@example.test',provider,
    redirect_url:'https://checkout.rampex.io/process-payment.php?provider=stripe&ref=fixture'
   })));
   assert.throws(()=>r.checkoutUrl('https://checkout.rampex.io/process-payment.php?provider='+provider,'stripe'));
 }
});
test('Stripe confirmation must refer to fixed Stripe provider with exact amount, currency and payout',()=>{
 const success=r.confirmation(completed,attempt,event);
 assert.equal(success.confirmed,true);
 for(const patch of [{provider:'hosted'},{provider:'topper'},{amount:48},{currency:'EUR'},{received_amount:48},{payout_currency:'BTC'}]){
  assert.throws(()=>r.confirmation({...completed,...patch},attempt,event));
 }
 for(const patch of [{provider:'hosted'},{provider:'topper'},{currency:'EUR'}]){
  assert.throws(()=>r.confirmation(completed,attempt,{...event,...patch}));
 }
});
test('legacy direct Stripe checkout remains retired',()=>{
 const route=fs.readFileSync('api/checkout.js','utf8');
 assert.match(route,/temporarily unavailable while payment options are updated/);
 assert.doesNotMatch(route,/checkout\.sessions\.create/);
});
