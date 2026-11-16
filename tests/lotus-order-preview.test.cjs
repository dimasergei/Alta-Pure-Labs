const test=require('node:test'),assert=require('node:assert/strict');
const {previewOrder}=require('../lib/lotus-order-preview');
const id='00000000-0000-4000-8000-000000000001';
const env={LOTUS_FULFILLMENT_ENABLED:'true',LOTUS_PARTNER_API_KEY:'ptr_live_'+'A'.repeat(43)};
function fixture(){
 const order={id,kind:'goods',status:'accepted',currency:'USD',total_cents:12255,request_data:{items:[{id:'bpc-157',name:'BPC-157',size:'10mg',qty:4}],address:{country:'US',region:'FL',postal_code:'33101',line1:'123 Fixture St',city:'Miami'}}};
 const values={commerce_invoices:order,commerce_supplier_settings:{enabled:true,verified_at:'2026-11-11',max_order_cents:50000},commerce_supplier_mappings:[{variant_key:'bpc-157|10mg',product:41,vials:1,verified_at:'2026-11-11'}],commerce_fulfillment_items:[],commerce_supplier_jobs:[]};
 const requests=[];
 const db={from(table){assert.ok(table in values);const q={select(){return q},eq(){return q},maybeSingle(){return q},then(resolve){return Promise.resolve({data:values[table]}).then(resolve);}};return q;},rpc(){throw Error('Preview must never write or claim a job');}};
 const fetchImpl=async(url,options)=>{requests.push({url,options});assert.equal(url,'https://partners.lotuspeptide.com/api/v1/quote');assert.equal(options.method,'POST');return {ok:true,status:200,json:async()=>({owed_total:'120.00',lines:[{problem:null}],problems:[]})};};
 return {order,values,requests,db,fetchImpl,preview:options=>previewOrder(db,{invoiceId:id,env,fetchImpl,...options})};
}
test('unpaid preview quotes all BOGO units without recording payment, creating a job or exposing customer data',async()=>{
 const f=fixture(),r=await f.preview();assert.equal(r.quote_available,true);assert.equal(r.ready,false);assert.equal(r.payment_confirmed,false);
 assert.equal(r.supplier_total_cents,12000);assert.equal(r.comparison.remaining_before_other_costs_cents,255);
 assert.ok(r.issues.some(x=>x.code==='low_headroom'));assert.ok(r.issues.some(x=>x.code==='awaiting_payment'));
 assert.deepEqual(JSON.parse(f.requests[0].options.body),{lines:[{product:41,vials:1,quantity:4}]});
 assert.equal(r.lines[0].pack_quantity,4);assert.equal(f.order.status,'accepted');
 assert.doesNotMatch(JSON.stringify(r),/Fixture|33101|ptr_live|Authorization|ship_to/);
});
test('paid verified live order returns eligibility only and still calls only quote',async()=>{
 const f=fixture();f.order.status='paid';f.order.total_cents=20000;const r=await f.preview();assert.equal(r.ready,true);assert.equal(f.requests.length,1);
});
test('CAD invoices never produce an invented USD margin',async()=>{
 const f=fixture();f.order.currency='CAD';const r=await f.preview();assert.equal(r.quote_available,true);assert.equal(r.comparison.comparable,false);assert.equal(r.comparison.remaining_before_other_costs_cents,null);assert.ok(r.issues.some(x=>x.code==='currency_comparison_unavailable'));assert.ok(!r.issues.some(x=>x.code==='low_headroom'));
});
test('missing mapping, unverified mapping, unsupported address and indivisible packs stop before any supplier call',async()=>{
 for(const alter of [f=>f.values.commerce_supplier_mappings=[],f=>f.values.commerce_supplier_mappings[0].verified_at=null,f=>f.order.request_data.address.country='CA',f=>f.order.request_data.address.region='ZZ',f=>f.order.request_data.address.line1='',f=>f.values.commerce_supplier_mappings[0].vials=3]){
  const f=fixture();alter(f);const r=await f.preview();assert.equal(r.ready,false);assert.equal(r.quote_available,false);assert.ok(r.issues.some(x=>x.severity==='error'));assert.equal(f.requests.length,0);
 }
});
test('paid allocated orders use their existing exact mapping rather than a replacement mapping',async()=>{
 const f=fixture();f.order.status='paid';f.values.commerce_supplier_mappings[0].product=99;
 f.values.commerce_fulfillment_items=[{variant_key:'bpc-157|10mg',item:f.order.request_data.items[0],route:'lotus',product:41,vials:2}];
 const r=await f.preview();assert.equal(r.ready,true);assert.deepEqual(JSON.parse(f.requests[0].options.body).lines,[{product:41,vials:2,quantity:2}]);
});
test('manual routing and allocation mismatch cannot preview a partial order as fully ready',async()=>{
 const f=fixture();f.order.status='paid';f.values.commerce_fulfillment_items=[{variant_key:'bpc-157|10mg',item:f.order.request_data.items[0],route:'manual',product:41,vials:1}];
 const r=await f.preview();assert.equal(r.ready,false);assert.equal(f.requests.length,0);assert.ok(r.issues.some(x=>x.code==='manual_or_mixed_routing'));
});
test('paid Platinum gift allocations are included in full, even when the supplier coalesces the same SKU',async()=>{
 const f=fixture();f.order.status='paid';f.order.total_cents=30000;
 f.order.request_data.items=[{id:'bac-3',name:'BAC Water',size:'3 mL',qty:1}];
 const gift={id:'gift-bac-3',name:'Complimentary BAC Water 3mL',size:'3 mL',qty:1,membership_gift:true};
 f.values.commerce_fulfillment_items=[
  {variant_key:'bac-3|3 mL',item:f.order.request_data.items[0],route:'lotus',product:45,vials:1},
  {variant_key:'gift-bac-3|3 mL',item:gift,route:'lotus',product:45,vials:1}
 ];
 const r=await f.preview();assert.equal(r.quote_available,true);assert.equal(r.ready,true);assert.equal(r.lines.length,2);
 assert.equal(r.lines[1].membership_gift,true);assert.equal(r.lines[1].qty,1);
 assert.deepEqual(JSON.parse(f.requests[0].options.body).lines,[{product:45,vials:1,quantity:1},{product:45,vials:1,quantity:1}]);
});
test('manual gifts, mismatched gift keys and unexplained extra allocations remain blocked',async()=>{
 for(const alter of [gift=>gift.route='manual',gift=>gift.variant_key='wrong|3 mL',gift=>gift.item.membership_gift=false]){
  const f=fixture();f.order.status='paid';const gift={variant_key:'gift-bac-3|3 mL',item:{id:'gift-bac-3',name:'Complimentary BAC Water',size:'3 mL',qty:1,membership_gift:true},route:'lotus',product:45,vials:1};
  alter(gift);f.values.commerce_fulfillment_items=[{variant_key:'bpc-157|10mg',item:f.order.request_data.items[0],route:'lotus',product:41,vials:1},gift];
  const r=await f.preview();assert.equal(r.quote_available,false);assert.equal(r.ready,false);assert.equal(f.requests.length,0);assert.ok(r.issues.some(x=>x.severity==='error'));
 }
});
test('existing submitted or uncertain job remains not ready for a new submission',async()=>{
 const f=fixture();f.order.status='paid';f.values.commerce_supplier_jobs=[{payload:{reference:'secret-stored-payload'}}];
 const r=await f.preview();assert.equal(r.quote_available,true);assert.equal(r.ready,false);assert.ok(r.issues.some(x=>x.code==='existing_supplier_job'));assert.doesNotMatch(JSON.stringify(r),/secret-stored-payload/);
});
test('stock problems, empty quotes and invalid amounts do not establish available pricing',async()=>{
 for(const quote of [{owed_total:'120.00',lines:[{problem:'private-provider-message'}]}, {owed_total:'120.00',lines:[]}, {owed_total:'oops',lines:[{problem:null}]}, {owed_total:'120.00',currency:'CAD',lines:[{problem:null}]}]){
  const f=fixture(),r=await f.preview({fetchImpl:async()=>({ok:true,status:200,json:async()=>quote})});assert.equal(r.ready,false);assert.equal(r.quote_available,false);assert.doesNotMatch(JSON.stringify(r),/private-provider-message/);
 }
});
test('provider authentication and transport errors are sanitized and never mutate state',async()=>{
 const f=fixture();const r=await f.preview({fetchImpl:async()=>({ok:false,status:401,json:async()=>({error:{code:'private_token_explanation'}})})});assert.equal(r.quote_available,false);assert.ok(r.issues.some(x=>x.code==='supplier_unavailable'));assert.doesNotMatch(JSON.stringify(r),/private_token_explanation/);
});
test('test credentials and disabled automation can quote but cannot report live readiness',async()=>{
 for(const nextEnv of [{...env,LOTUS_PARTNER_API_KEY:'ptr_test_'+'A'.repeat(43)},{...env,LOTUS_FULFILLMENT_ENABLED:'false'}]){const f=fixture();f.order.status='paid';const r=await f.preview({env:nextEnv});assert.equal(r.quote_available,true);assert.equal(r.ready,false);assert.equal(r.automation_enabled,false);}
});
test('supplier cost cap blocks readiness; negative headroom is a review warning, not fabricated profit',async()=>{
 const f=fixture();f.order.status='paid';f.order.total_cents=10000;f.values.commerce_supplier_settings.max_order_cents=11999;const r=await f.preview();assert.equal(r.quote_available,true);assert.equal(r.ready,false);assert.equal(r.comparison.remaining_before_other_costs_cents,-2000);assert.ok(r.issues.some(x=>x.code==='cost_limit'));assert.ok(r.issues.some(x=>x.code==='supplier_cost_exceeds_total'));
});
test('non-goods and canceled orders cannot contact Lotus; malformed identifiers fail before DB access',async()=>{
 for(const alter of [f=>f.order.kind='membership',f=>f.order.status='void']){const f=fixture();alter(f);const r=await f.preview();assert.equal(r.quote_available,false);assert.equal(f.requests.length,0);}
 await assert.rejects(previewOrder({}, {invoiceId:'invalid'}),error=>error.status===400);
});
