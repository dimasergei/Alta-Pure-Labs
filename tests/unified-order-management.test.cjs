'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {execute,manualPaymentAllowed}=require('../lib/unified-admin-actions');
const {publicHistory,handle}=require('../lib/lotus-admin');
const id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',methodId='dddddddd-dddd-4ddd-8ddd-dddddddddddd',receiptId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const method={id:methodId,kind:'bank_transfer',currency:'USD',label:'US wire',native_provider:null};
const order={id,method_id:methodId,status:'accepted',kind:'goods',currency:'USD',total_cents:12000,version:1,payment_snapshot:{kind:'bank_transfer'}};
const payment={action:'record_payment',id,expected_version:1,method_id:methodId,receipt_id:receiptId,external_reference:'BANK-TX-123456',confirm_funds_received:true};
function fixture(overrides={}){
 const calls=[];return{calls,from(table){return{select(){return this},eq(){return this},async maybeSingle(){return{data:table==='commerce_invoices'?{...order,...overrides.order}:{...method,...overrides.method}}}}},async rpc(name,args){calls.push({name,args});return overrides.rpc||{data:{id,status:'paid'}}}};
}
const quiet={notificationsDispatch:async()=>({accepted:0}),env:{}};
test('manual payment eligibility excludes native providers, wrong currencies, stale methods and non-pending orders',()=>{
 assert.equal(manualPaymentAllowed(order,method),true);
 for(const [o,m] of [[{...order,status:'paid'},method],[order,{...method,native_provider:'stripe'}],[order,{...method,currency:'CAD'}],[{...order,method_id:receiptId},method],[{...order,payment_snapshot:{kind:'hosted_link'}},method]])assert.equal(manualPaymentAllowed(o,m),false);
});
test('payment records exact server-side invoice under stable client receipt identity',async()=>{
 const db=fixture();const result=await execute(db,{...payment,amount_cents:1,currency:'CAD'},quiet);
 assert.equal(result.status,200);assert.deepEqual(db.calls,[{name:'commerce_admin_record_bank_payment',args:{p_invoice:id,p_data:{method_id:methodId,expected_version:1,receipt_id:receiptId,external_reference:'BANK-TX-123456',confirm_funds_received:true}}}]);
});
test('payment requires confirmed funds, valid method, version, receipt UUID and bank reference',async()=>{
 for(const change of [{confirm_funds_received:false},{method_id:receiptId},{expected_version:undefined},{receipt_id:'x'},{external_reference:'pending'}]){
  const db=fixture();assert.ok((await execute(db,{...payment,...change},quiet)).status>=400);assert.equal(db.calls.length,0);
 }
 const provider=fixture({method:{native_provider:'stripe'}});assert.equal((await execute(provider,payment,quiet)).status,409);assert.equal(provider.calls.length,0);
});
test('payment retries use database receipt reconciliation even after invoice advancement',async()=>{
 const db=fixture({order:{status:'shipped',version:4},rpc:{data:{id,status:'shipped',replayed:true}}});let run=0;
 const r=await execute(db,payment,{...quiet,env:{LOTUS_FULFILLMENT_ENABLED:'true'},lotusRun:async()=>{run++;}});
 assert.equal(r.status,200);assert.equal(r.data.replayed,true);assert.equal(db.calls.length,1);assert.equal(run,0);
});
test('successful payment independently starts durable notifications and enabled supplier worker; failures do not undo receipt',async()=>{
 const db=fixture();let run=0;
 const r=await execute(db,payment,{env:{LOTUS_FULFILLMENT_ENABLED:'true'},notificationsDispatch:async()=>{throw Error('mail down')},lotusRun:async()=>{run++;return{processed:1,status:'submitted'}}});
 assert.equal(r.status,200);assert.equal(r.data.notification,'queued');assert.equal(run,1);assert.equal(r.data.supplier.status,'submitted');
 const failed=fixture({rpc:{error:{code:'40001'}}});run=0;
 assert.equal((await execute(failed,payment,{env:{LOTUS_FULFILLMENT_ENABLED:'true'},notificationsDispatch:async()=>{run++},lotusRun:async()=>{run++}})).status,409);assert.equal(run,0);
});
test('whole-order updates call allocation-aware transaction and tracking validation cannot throw',async()=>{
 const db=fixture({order:{status:'paid'}}),body={action:'update_order',id,version:1,status:'shipped',note:'Supplier confirmed dispatch',tracking_carrier:'UPS',tracking_number:'TRACK123'};
 assert.equal((await execute(db,body,quiet)).status,200);assert.equal(db.calls[0].name,'commerce_admin_fulfill_order');assert.equal(db.calls[0].args.p_data.status,'shipped');
 assert.equal((await execute(db,{...body,tracking_carrier:123},quiet)).status,400);
 assert.equal((await execute(db,{...body,version:2},quiet)).status,409);
 const correction=fixture({order:{status:'shipped'}});
 assert.equal((await execute(correction,{...body,action:'update_tracking',status:undefined},quiet)).status,200);assert.equal(correction.calls[0].args.p_data.action,'update_tracking');
});
test('history exposes allowlisted events and bank transaction references without payment secrets',()=>{
 const rows=publicHistory([{id:'event',action:'payment_recorded',actor:'admin',created_at:'now',details:{receipt_id:receiptId,instructions:'SECRET BANK ROUTING',account:'SECRET',note:'Confirmed receipt',payload:{secret:'SECRET'}}}],[{id:receiptId,external_reference:'BANK12345'}]);
 assert.equal(rows[0].reference,'BANK12345');assert.equal(rows[0].note,'Confirmed receipt');assert.equal(JSON.stringify(rows).includes('SECRET'),false);assert.equal('details' in rows[0],false);
});
test('unified detail exposes guarded payment controls and true supplier readiness without credentials',async()=>{
 const password='fixture-admin-password-'+'x'.repeat(32),env={ADMIN_ORDERS_PASSWORD:password,LOTUS_FULFILLMENT_ENABLED:'true',LOTUS_PARTNER_API_KEY:'ptr_live_'+'A'.repeat(43)};
 const values={commerce_invoices:order,commerce_payment_methods:method,commerce_events:[],commerce_receipts:[],commerce_fulfillment_items:[],commerce_supplier_jobs:[],commerce_supplier_mappings:[],commerce_supplier_settings:{enabled:true,verified_at:'2026-11-16',max_order_cents:10000}};
 const db={from(table){const q={select(){return q},eq(){return q},order(){return q},limit(){return q},single(){return q},maybeSingle(){return q},then(resolve){return Promise.resolve({data:values[table]}).then(resolve)}};return q;}};
 const req={method:'GET',headers:{'x-admin-password':password}},params=new URLSearchParams({view:'detail',id});
 let code,payload;const res={setHeader(){},status(n){code=n;return this},json(x){payload=x;return x}};
 await handle(req,res,params,{db,env});assert.equal(code,200);assert.equal(payload.manual_payment_allowed,true);assert.deepEqual(payload.payment_method,{id:methodId,kind:'bank_transfer',label:'US wire',currency:'USD'});assert.equal(payload.supplier_enabled,true);
 assert.deepEqual(payload.fulfillment_provider,{name:'99Purity Peptides',route:'manual',automatic_submission:false});
 assert.equal(JSON.stringify(payload).includes(env.LOTUS_PARTNER_API_KEY),false);
 values.commerce_supplier_settings.enabled=false;await handle(req,res,params,{db,env});assert.equal(payload.supplier_enabled,false);
 values.commerce_supplier_settings.enabled=true;await handle(req,res,params,{db,env:{...env,LOTUS_PARTNER_API_KEY:''}});assert.equal(payload.supplier_enabled,false);
});
test('disabled Lotus rejects every remote admin action before network, mutation or supplier reads',async()=>{
 const password='fixture-admin-password-'+'x'.repeat(32),env={ADMIN_ORDERS_PASSWORD:password,SITE_URL:'https://altapurelabs.com',LOTUS_FULFILLMENT_ENABLED:'false'};
 const req={method:'POST',headers:{'x-admin-password':password,origin:env.SITE_URL,'content-type':'application/json'}};
 const db={from(){throw Error('Unexpected supplier read')},rpc(){throw Error('Unexpected supplier mutation')}};
 for(const action of ['preview_lotus_order','label','catalog','run','save_mapping','retry','takeover','assign']){
  let code,payload;const res={setHeader(){},status(n){code=n;return this},json(x){payload=x;return x}};
  await handle({...req,body:{action,id,route:'lotus'}},res,new URLSearchParams(),{db,env,fetchImpl:async()=>{throw Error('Unexpected network call')}});
  assert.equal(code,409,action);assert.match(payload.error,/Lotus fulfillment is disabled/);
 }
});
test('database kill switch blocks Lotus even with a live API key and enabled environment',async()=>{
 const password='fixture-admin-password-'+'x'.repeat(32),env={ADMIN_ORDERS_PASSWORD:password,SITE_URL:'https://altapurelabs.com',LOTUS_FULFILLMENT_ENABLED:'true',LOTUS_PARTNER_API_KEY:'ptr_live_'+'A'.repeat(43)};
 const db={from(table){assert.equal(table,'commerce_supplier_settings');return{select(){return this},eq(){return this},single(){return{data:{enabled:false,verified_at:'2026-11-16',max_order_cents:50000}}}}}};
 let code;const res={setHeader(){},status(n){code=n;return this},json(x){return x}};
 await handle({method:'POST',headers:{'x-admin-password':password,origin:env.SITE_URL,'content-type':'application/json'},body:{action:'preview_lotus_order',id}},res,new URLSearchParams(),{db,env,fetchImpl:async()=>{throw Error('Unexpected network call')}});
 assert.equal(code,409);
});
test('manual assignment accepts only the selected supplier and remains available when Lotus is disabled',async()=>{
 const password='fixture-admin-password-'+'x'.repeat(32),env={ADMIN_ORDERS_PASSWORD:password,SITE_URL:'https://altapurelabs.com',LOTUS_FULFILLMENT_ENABLED:'false'};
 let calls=0;const db={rpc:async(name,args)=>{calls++;assert.equal(name,'commerce_fulfillment_admin');assert.equal(args.p_data.supplier_name,'99Purity Peptides');return{data:true}}};
 const req={method:'POST',headers:{'x-admin-password':password,origin:env.SITE_URL,'content-type':'application/json'},body:{action:'assign',id,route:'manual',note:'Supplier confirmed allocation',supplier_name:'99Purity Peptides'}};
 let code;const res={setHeader(){},status(n){code=n;return this},json(x){return x}};
 await handle(req,res,new URLSearchParams(),{db,env});assert.equal(code,200);assert.equal(calls,1);
 await handle({...req,body:{...req.body,supplier_name:'Lotus'}},res,new URLSearchParams(),{db,env});assert.equal(code,400);assert.equal(calls,1);
});
