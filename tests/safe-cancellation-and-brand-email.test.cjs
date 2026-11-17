'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const safe=require('../lib/commerce-cancellation'),actions=require('../lib/unified-admin-actions'),email=require('../lib/invoice-notifications');
const order={id:'10000000-0000-4000-8000-000000000001',customer_id:'20000000-0000-4000-8000-000000000001',status:'accepted',total_cents:7900,currency:'USD',version:1};
const attempt={id:'30000000-0000-4000-8000-000000000001',invoice_id:order.id,provider:'rampex',mode:'live',state:'redirected',rampex_provider:'stripe',rampex_link_id:'fixture-000',amount_cents:7900,currency:'USD'};
const env={RAMPEX_API_KEY:'offline-fixture-only',ORDER_CONFIRMATION_FROM:'AltaPure <orders@example.test>'};
const response=(status='active',other={})=>async()=>new Response(JSON.stringify({success:true,data:{link_id:attempt.rampex_link_id,amount:79,currency:'USD',status,...other}}),{status:200});
function db({attempts=[attempt],status='accepted'}={}){
 const calls=[];
 return{calls,from(table){
  return{select(){return this},eq(){return this},async maybeSingle(){return{data:table==='commerce_invoices'?{...order,status}:null,error:null}},then(resolve){return resolve({data:table==='commerce_gateway_attempts'?attempts:[],error:null})}};
 },async rpc(name,args){calls.push({name,args});return{data:name==='commerce_cancel_checkout'?{id:order.id,status:'void',provider_link_may_remain_live:true}:{id:order.id,status:'processing'}}}};
}
test('unpaid provider link can be safely canceled after exact amount and link status check',async()=>{
 const d=db();const confirmed=await safe.verifyUnpaid(d,order,{env,fetchImpl:response()});
 assert.equal(confirmed.confirmed_unpaid,true);
 assert.equal(confirmed.provider_link_may_remain_live,true);
 const result=await actions.execute(d,{action:'cancel_order',id:order.id,confirm_unpaid:true},{env,fetchImpl:response()});
 assert.equal(result.status,200);
 assert.equal(d.calls.filter(c=>c.name==='commerce_cancel_checkout').length,1);
});
test('cancel fails closed on any completed, mismatched, ambiguous, or unavailable link',async()=>{
 for(const st of ['completed','unknown','refunded'])await assert.rejects(()=>safe.verifyUnpaid(db(),order,{env,fetchImpl:response(st)}));
 for(const other of [{link_id:'other'},{amount:80},{currency:'CAD'},{received_amount:79}])await assert.rejects(()=>safe.verifyUnpaid(db(),order,{env,fetchImpl:response('active',other)}));
 await assert.rejects(()=>safe.verifyUnpaid(db(),order,{env,fetchImpl:async()=>{throw Error('offline')}}));
 for(const st of ['review','unknown','paid','started'])await assert.rejects(()=>safe.verifyUnpaid(db({attempts:[{...attempt,state:st}]}),order,{env,fetchImpl:response()}));
});
test('active crypto cancellation records a durable hold without falsely confirming unpaid or voiding',async()=>{
 const d=db({attempts:[{...attempt,provider:'polygon_usdc',state:'started'}]});
 d.rpc=async(name,args)=>{d.calls.push({name,args});assert.equal(name,'commerce_request_polygon_usdc_cancellation');return{data:{id:order.id,status:'accepted',cancellation_status:'pending',cancellation_requested_at:'2026-11-17T22:00:00Z'}};};
 const result=await safe.cancelCheckout(d,order,{customerId:order.customer_id,env,fetchImpl:async()=>{throw Error('RPC unavailable');}});
 assert.equal(result.cancellation_status,'pending');assert.equal(result.status,'accepted');assert.equal(result.confirmed_unpaid,undefined);
 assert.equal(d.calls.length,1);assert.equal(d.calls[0].args.p_customer,order.customer_id);
});
test('admin accepts pending crypto cancellation and does not fall through to final void',async()=>{
 const d=db({attempts:[{...attempt,provider:'polygon_usdc',state:'started'}]});
 d.rpc=async(name,args)=>{d.calls.push({name,args});assert.equal(name,'commerce_request_polygon_usdc_cancellation');return{data:{id:order.id,status:'accepted',cancellation_status:'pending'}};};
 const result=await actions.execute(d,{action:'cancel_order',id:order.id,confirm_unpaid:true},{env,notificationsDispatch:async()=>({accepted:0})});
 assert.equal(result.status,200);assert.equal(result.data.cancellation_status,'pending');assert.equal(d.calls[0].args.p_actor,'admin:unpaid-cancellation');assert.equal(d.calls.length,1);
});
test('admin rejects refund before verified external refund and never initiates charges',async()=>{
 const d=db();
 const out=await actions.execute(d,{action:'record_verified_refund',id:order.id,version:1,external_reference:'provider-transaction123',confirm_external_refund:true},{env});
 assert.equal(out.status,409);
 assert.deepEqual(d.calls,[]);
});
test('checkout email uses PURE with compact order reference and sanitized items',()=>{
 const notice={audience:'customer',event_action:'checkout_placed',snapshot:{id:order.id,checkout_version:'checkout-2026-11-v4',customer_name:'Test <script>',customer_email:'test@example.test',currency:'USD',status:'accepted',total_cents:7900},detail:{pricing:{lines:[{name:'Compound <img>',size:'10mg',qty:2,line_total_cents:5400}]},request_data:{name:'Test Researcher',address:{line1:'Research Lane',city:'Miami',country:'US'}},subtotal_cents:12000,shipping_cents:2500}};
 const m=email.envelope(notice,env);
 assert.match(m.subject,/AP1000000000/);
 assert.match(m.html,/<h1[^>]*><img src="https:\/\/getpurelabs.com\/assets\/pure-wordmark-dark.png" alt="PURE"/);
 assert.doesNotMatch(m.subject+' '+m.html+' '+m.text,/PURE Labs|AltaPure Labs/i);
 assert.equal(m.from,'PURE <orders@example.test>');
 assert.match(m.html,/Compound &lt;img&gt;/);
 assert.doesNotMatch(m.html,/Compound <img>/);
 assert.match(m.html,/Order items|Shipping address/);
 assert.match(m.html,/View secure order/);
 assert.doesNotMatch(m.text,/A bank transfer remains pending/);
});
