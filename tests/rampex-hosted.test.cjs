'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const r=require('../lib/rampex'),protocol=require('../lib/rampex-protocol');
const attempt={id:'10000000-0000-4000-8000-000000000001',invoice_id:'20000000-0000-4000-8000-000000000001',provider:'rampex',mode:'live',rampex_provider:'hosted',rampex_link_id:'hosted-fixture-123',amount_cents:4900,currency:'USD'};
const status={link_id:attempt.rampex_link_id,status:'completed',amount:49,received_amount:49,currency:'USD',paid_at:'2026-11-12T12:00:00Z',transaction_hash:'0x'+'8'.repeat(64),payout_amount:47,payout_currency:'USDC'};
const event={...status,event:'payment.completed',metadata:{order_id:attempt.id},payout_network:'polygon',txid_out:'0x'+'9'.repeat(64)};
const env={RAMPEX_API_KEY:'offline-fixture-only',RAMPEX_WEBHOOK_SECRET:'offline-fixture-secret-not-real'};
const rows=[{id:'stripe',status:'active',minimum_currency:'USD',minimum_amount:2},{id:'applepay',status:'active',minimum_currency:'USD',minimum_amount:10},{id:'googlepay',status:'active',minimum_currency:'USD',minimum_amount:10}];
const response=data=>new Response(JSON.stringify({success:true,data}),{status:200});
test('hosted availability uses active USD routes without requiring a synthetic hosted status row',async()=>{
 const out=await r.providerStatus('hosted',4900,async()=>response({providers:rows}));assert.equal(out.id,'hosted');assert.deepEqual(out.eligible_providers,['stripe','applepay','googlepay']);assert.equal(out.minimum_amount,2);
});
test('hosted checks limits without silently switching an explicit provider',async()=>{
 const out=await r.providerStatus('hosted',500,async()=>response({providers:rows}));assert.deepEqual(out.eligible_providers,['stripe']);
 await assert.rejects(()=>r.providerStatus('hosted',100,async()=>response({providers:rows})));
 for(const bad of [[],rows.map(p=>({...p,status:'inactive'})),rows.map(p=>({...p,minimum_amount:'unknown'})),rows.map(p=>({...p,minimum_currency:'EUR'}))])await assert.rejects(()=>r.providerStatus('hosted',4900,async()=>response({providers:bad})));
 await assert.rejects(()=>r.providerStatus('rampnetwork',4900,async()=>response({providers:rows})));
});
test('the exact server-side order amount and hosted provider are sent together',async()=>{
 let sent;const link=await r.create(attempt,'customer@example.invalid',env,async(url,init)=>{sent=JSON.parse(init.body);return response({link_id:attempt.rampex_link_id,status:'active',amount:49,currency:'USD',customer_email:'customer@example.invalid',provider:'hosted',redirect_url:'https://checkout.rampex.io/pay/fixture?provider=hosted'});});
 assert.equal(sent.provider,'hosted');assert.equal(sent.amount,49);assert.equal(sent.woo_order_id,attempt.id);assert.ok(link.url.startsWith('https://checkout.rampex.io/'));assert.equal(sent.apple_pay,undefined);assert.equal(sent.google_pay,undefined);
});
test('hosted completions permit customer-selected Stripe, Apple Pay and Google Pay',()=>{
 for(const provider of ['stripe','applepay','googlepay','banxa'])assert.equal(r.confirmation({...status,provider},attempt,{...event,provider}).confirmed,true);
});
test('hosted does not loosen amount, reference, payout or conflicting-provider checks',()=>{
 for(const patch of [{received_amount:48},{amount:50},{currency:'CAD'},{link_id:'other'},{payout_currency:'USDT'},{test:true}])assert.throws(()=>r.confirmation({...status,...patch},attempt,event));
 assert.throws(()=>r.confirmation({...status,provider:'applepay'},attempt,{...event,provider:'googlepay'}));
 assert.throws(()=>r.confirmation({...status,provider:'https://bad.invalid'},attempt,event));
 assert.throws(()=>r.confirmation({...status,provider:'stripe'},{...attempt,rampex_provider:'rampnetwork'},event));
});
test('hosted payment creation refuses a substituted single-provider redirect',()=>{
 assert.throws(()=>r.checkoutUrl('https://checkout.rampex.io/pay/x?provider=stripe','hosted'));assert.throws(()=>r.checkoutUrl('https://bad.invalid/pay','hosted'));
});
test('hosted request helper accepts the authorized route but preserves server return URL validation',()=>{
 const result=protocol.buildPaymentRequest({amount_cents:4900,currency:'USD',email:'customer@example.invalid',order_id:'invoice_123',provider:'hosted',provider_status:{id:'hosted',status:'active',minimum_currency:'USD',minimum_amount:2},return_url:'https://altapurelabs.com/invoice.html?id=invoice_123'});assert.equal(result.body.provider,'hosted');
});
test('wallet copy is provider-conditional and existing native wallet flags are not fabricated',()=>{
 const page=fs.readFileSync('native-pay.js','utf8');assert.match(page,/credit or debit card through Stripe via Rampex/);assert.match(page,/g\.provider==='nmi'/);assert.deepEqual(r.configuration(env).wallets,{apple:false,google:false});
});
