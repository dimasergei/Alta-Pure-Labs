'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const mail=require('../lib/invoice-notifications'),entry=require('../lib/manual-commerce-integrated'),base=require('../lib/multi-payment-commerce');
const id='10000000-0000-4000-8000-000000000001',nid='20000000-0000-4000-8000-000000000001';
const env={RESEND_API_KEY:'fixture-only',ORDER_CONFIRMATION_FROM:'AltaPure <orders@example.test>',ADMIN_ORDER_EMAIL:'team@example.test',ADMIN_ORDERS_PASSWORD:'x'.repeat(40),SITE_URL:'https://altapurelabs.com',COMMERCE_NOTIFICATION_JOB_SECRET:'w'.repeat(48)};
const notification={id:nid,invoice_id:id,audience:'customer',event_action:'issued',snapshot:{id,customer_email:'owner@example.test',customer_name:'<script>bad</script>',status:'issued',kind:'goods',total_cents:12900,currency:'USD',expires_at:'2026-12-01T00:00:00Z',event_at:'2026-11-10T00:00:00Z',payment_instructions:'BANK-PRIVATE-SHOULD-NOT-APPEAR'}};
test('email sender rebrands only the display name and preserves the configured mailbox',()=>{
 const {emailSender}=require('../lib/brand-display');
 for(const value of ['AltaPure Labs <orders@altapurelabs.com>','ALTAPURELABS <orders@altapurelabs.com>','Alta Pure Labs <orders@altapurelabs.com>','PURE Labs <orders@altapurelabs.com>','PureLabs <orders@altapurelabs.com>','Pure Labs <orders@altapurelabs.com>'])assert.equal(emailSender(value),'PURE <orders@altapurelabs.com>');
 assert.equal(emailSender('"AltaPure" <orders@example.test>'),'"PURE" <orders@example.test>');
 assert.equal(emailSender('"PURE Labs" <Orders+status@altapurelabs.com>'),'"PURE" <Orders+status@altapurelabs.com>');
 for(const value of ['altapurelabs@protonmail.com','AltaPureLabs@example.test','purelabs@example.test','Operations <altapurelabs@protonmail.com>','PURE <orders@altapurelabs.com>'])assert.equal(emailSender(value),value);
 const out=mail.envelope(notification,{...env,ORDER_CONFIRMATION_FROM:'PURE Labs <orders@example.test>'});assert.equal(out.from,'PURE <orders@example.test>');assert.match(out.subject,/^PURE — /);assert.match(out.html,/<h1[^>]*><img src="https:\/\/getpurelabs.com\/assets\/pure-wordmark-dark.png" alt="PURE"/);assert.doesNotMatch(out.html,/PURE Labs/);
});
function response(){return{code:200,body:null,setHeader(){},status(n){this.code=n;return this;},json(b){this.body=b;return this;}};}
function dbMock(options={}){const calls=[];const q={select(){return q;},in(){return q;},lte(){return q;},eq(){return q;},order(){return q;},limit:async()=>({data:[notification]})};return{calls,from(){return q;},rpc:async(name,args)=>{calls.push({name,args});if(name==='commerce_claim_notification')return{data:{claimed:options.claimed!==false,state:'accepted',claim:id,envelope:options.storedEnvelope||args.p_envelope}};return options.finishError?{error:{code:'fixture'}}:{data:true};}};}
test('notification scripts parse and emails contain no receiving instructions',()=>{for(const p of ['invoice-automation-ui.js','invoice-automation-build.cjs'])assert.doesNotThrow(()=>new vm.Script(fs.readFileSync(p,'utf8')));const out=mail.envelope(notification,env);assert.deepEqual(out.to,['owner@example.test']);assert.match(out.text,/129.00/);assert.match(out.html,/account\/purchases\?id=/);assert.doesNotMatch(out.html,/BANK-PRIVATE|<script>/);assert.doesNotMatch(out.text,/BANK-PRIVATE/);});
test('admin alerts go to configured staff, invalid recipients are held',()=>{assert.deepEqual(mail.envelope({...notification,audience:'admin'},env).to,['team@example.test']);assert.equal(mail.envelope({...notification,snapshot:{...notification.snapshot,customer_email:'victim@example.test,other@example.test'}},env),null);assert.equal(mail.envelope({...notification,snapshot:{...notification.snapshot,id:'not-a-uuid'}},env),null);});
test('manual product invoice alerts open the unified order review without sending receiving details or a zero-dollar request',()=>{
 const request={...notification,audience:'admin',event_action:'requested',snapshot:{...notification.snapshot,status:'requested',currency:null,total_cents:null}};
 const out=mail.envelope(request,env);
 assert.match(out.text,/admin-orders\.html/);assert.match(out.text,/Review CAD order/);
 assert.doesNotMatch(out.text,/Order amount:|BANK-PRIVATE|admin-payments/);assert.doesNotMatch(out.html,/BANK-PRIVATE|admin-payments/);
 const customer=mail.envelope({...request,audience:'customer'},env);
 assert.match(customer.text,/Payment is not due yet/);assert.match(customer.text,/account\/purchases\?id=/);assert.doesNotMatch(customer.text,/BANK-PRIVATE|Order amount:/);
 const issued=mail.envelope({...notification,snapshot:{...notification.snapshot,currency:'CAD'}},env);
 assert.match(issued.text,/CA\$129\.00/);assert.match(issued.text,/accept the final order amount/);
});
test('accepted CAD checkout, verified receipt and refund emails preserve CAD amounts and province with normal order language',()=>{
 const detail={request_data:{address:{line1:'123 Fixture Street',city:'Toronto',region:'ON',postal_code:'M5V 1A1',country:'CA'},items:[{name:'Fixture product',size:'60mg',qty:1,unit_price_usd_cents:10000}]},pricing:{currency:'CAD',fx_ppm:1350000,coupon_code:'BLACKFRIDAY15',coupon_discount_cents:2025,crypto_discount_cents:0,lines:[{name:'Fixture product',size:'60mg',qty:1,unit_price_usd_cents:10000,unit_price_cents:13500,gross_cents:13500,discount_cents:2025,line_total_cents:11475}]},subtotal_cents:13500,discount_cents:2025,shipping_cents:2000,tax_cents:1752,points_redeemed:0,credit_redeemed_cents:0};
 const before=JSON.stringify(detail);
 for(const [event_action,status] of [['checkout_placed','accepted'],['payment_recorded','paid'],['full_refund_recorded','refunded']])for(const audience of ['customer','admin']){
  const out=mail.envelope({...notification,audience,event_action,detail,snapshot:{...notification.snapshot,checkout_version:'interac-checkout-2026-11-v1',status,currency:'CAD',total_cents:15227}},env);
  assert.match(out.text,/Subtotal: CA\$135\.00/);assert.match(out.text,/Coupon discount \(BLACKFRIDAY15\): -CA\$20\.25/);
  assert.match(out.text,/Shipping: CA\$20\.00/);assert.match(out.text,/Tax: CA\$17\.52/);assert.match(out.text,/Total: CA\$152\.27/);
  assert.match(out.text,/Toronto, ON, M5V 1A1/);assert.match(out.text,/Fixture product 60mg × 1: CA\$135\.00/);
  assert.doesNotMatch(out.text,/invoice|USD|BANK-PRIVATE|CA\$100\.00|reviewed total/i);
  assert.doesNotMatch(out.html,/BANK-PRIVATE|<script>/);
  if(event_action==='checkout_placed'){assert.match(out.text,/Payment is not yet confirmed/);assert.doesNotMatch(out.text,/payment was successful/);}
  if(event_action==='payment_recorded')assert.match(out.text,/payment was successful/);
  if(event_action==='full_refund_recorded')assert.match(out.text,/verified external refund was recorded/);
 }
 assert.equal(JSON.stringify(detail),before,'email does not reprice or mutate the stored order');
});
test('CAD checkout notifications wait for recorded CAD pricing instead of relabelling fallback USD catalog amounts',()=>{
 const request={...notification,event_action:'checkout_placed',snapshot:{...notification.snapshot,status:'accepted',currency:'CAD',total_cents:13500,checkout_version:'interac-checkout-2026-11-v1'}};
 const usdItems=[{name:'Fixture product',size:'60mg',qty:1,unit_price_usd_cents:10000}];
 for(const detail of [undefined,{request_data:{items:usdItems}},{request_data:{items:usdItems},pricing:{currency:'USD',lines:[{...usdItems[0],unit_price_cents:10000}]}},{pricing:{currency:'CAD',lines:usdItems},subtotal_cents:13500,discount_cents:0,shipping_cents:0,tax_cents:0}])assert.equal(mail.envelope({...request,detail},env),null);
});
test('successful sends use the immutable claimed envelope and stable idempotency key',async()=>{const old={from:env.ORDER_CONFIRMATION_FROM,to:['owner@example.test'],subject:'Previously saved',text:'Saved immutable body'};const db=dbMock({storedEnvelope:old});let sent;const out=await mail.dispatch(db,{env,delay:async()=>{},fetchImpl:async(url,args)=>{sent={url,args};return{ok:true,json:async()=>({id:'mail-fixture'})};}});assert.equal(out.accepted,1);assert.equal(sent.args.headers['Idempotency-Key'],'altapure-invoice/'+nid);assert.deepEqual(JSON.parse(sent.args.body),old);assert.equal(db.calls[1].args.p_outcome,'accepted');});
test('no claim means no duplicate email',async()=>{let sent=0;const out=await mail.dispatch(dbMock({claimed:false}),{env,fetchImpl:async()=>{sent++;}});assert.equal(sent,0);assert.equal(out.held,1);});
test('transport failure records a bounded retry without exposing credentials',async()=>{const db=dbMock();const out=await mail.dispatch(db,{env,fetchImpl:async()=>{throw Error('credential');}});assert.equal(out.failed,1);assert.equal(db.calls[1].args.p_error,'transport_uncertain');assert.equal(JSON.stringify(out).includes('fixture-only'),false);});
test('uncertain database completion never claims accepted delivery',async()=>{const out=await mail.dispatch(dbMock({finishError:true}),{env,fetchImpl:async()=>({ok:true,json:async()=>({id:'provider-id'})})});assert.equal(out.accepted,0);assert.equal(out.held,1);});
test('missing transport does not query or send',async()=>{const out=await mail.dispatch({}, {env:{}});assert.equal(out.configured,false);assert.equal(out.attempted,0);});
test('job endpoint rejects anonymous tokens and non-POST methods',async()=>{const a=response();await entry.handle({method:'POST',headers:{}},a,new URLSearchParams({commerce:'worker'}),{env,db:{}});assert.equal(a.code,401);const b=response();await entry.handle({method:'GET',headers:{authorization:'Bearer '+env.COMMERCE_NOTIFICATION_JOB_SECRET}},b,new URLSearchParams({commerce:'worker'}),{env,db:{}});assert.equal(b.code,405);});
test('automation settings remain admin-only and recovery is same-origin',async()=>{const a=response();await entry.handle({method:'GET',headers:{}},a,new URLSearchParams({commerce:'admin',view:'automation'}),{env,db:{}});assert.equal(a.code,401);const b=response();await entry.handle({method:'POST',headers:{'x-admin-password':env.ADMIN_ORDERS_PASSWORD,origin:'https://wrong.test','content-type':'application/json'},body:{action:'retry_notifications'}},b,new URLSearchParams({commerce:'admin'}),{env,db:{}});assert.equal(b.code,403);});
test('failed original invoice commands never send mail',async()=>{const original=base.handle;try{base.handle=async(req,res)=>res.status(409).json({error:'Rejected'});const out=response();await entry.handle({method:'POST',headers:{},body:{action:'issue',id}},out,new URLSearchParams({commerce:'admin'}),{env,db:{}});assert.equal(out.code,409);assert.equal(out.body.error,'Rejected');}finally{base.handle=original;}});
test('successful financial command stays successful even if notification storage is unavailable',async()=>{const original=base.handle;try{base.handle=async(req,res)=>res.status(200).json({id,status:'paid'});const out=response();await entry.handle({method:'POST',headers:{},body:{action:'record_payment',id}},out,new URLSearchParams({commerce:'admin'}),{env,db:{from(){throw Error('unavailable');}}});assert.equal(out.code,200);assert.equal(out.body.status,'paid');assert.equal(out.body.notification,'queued');}finally{base.handle=original;}});
