'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const checkout=require('../lib/direct-checkout'),config=require('../config/checkout.json');
const id='c0000000-0000-4000-8000-000000000001',uid='c0000000-0000-4000-8000-000000000002',mid='c0000000-0000-4000-8000-000000000003';
const user={id:uid,email:'customer@example.test',email_confirmed_at:'2026-01-01'};
const method={id:mid,active:true,kind:'hosted_link',native_provider:'rampex',rampex_provider:'hosted',countries:['US','CA','GB'],version:1,currency:'USD',sale_scope:'goods',label:'Card'};
const catalog=[{id:'fixture-product',name:'Fixture product',variants:[{size:'5mg',price:100}]}];
const body={id,kind:'goods',method_id:mid,consent:true,checkout_version:config.version,items:[{id:'fixture-product',size:'5mg',qty:1,price:0.01}],name:'Customer',organization:'Lab',address:{line1:'123 Fixture Street',city:'Fixture City',region:'FL',postal_code:'34287',country:'US'},research_use:true};
const env={RAMPEX_API_KEY:'isolated-rampex-fixture',RAMPEX_WEBHOOK_SECRET:'isolated-rampex-webhook-secret',RAMPEX_ENABLED:'true',RAMPEX_MODE:'live',SITE_URL:'https://getpurelabs.com',ADMIN_ORDERS_PASSWORD:'x'.repeat(40),CHECKOUT_RATE_LIMIT_SECRET:'fixture-secret-with-at-least-32-characters'};
function response(){return{code:200,setHeader(){},status(n){this.code=n;return this;},json(b){this.body=b;return this;}};}
function dbMock({balance={points:1000,credit_cents:5000},membership=null,existing=null,partner=null,existingReferral=null,paymentMethods=[method]}={}){
 const calls=[];return{calls,auth:{getUser:async()=>({data:{user}})},from(table){const value=table==='commerce_gateway_accounts'?paymentMethods.filter(m=>m.native_provider).map(m=>({method_id:m.id,provider:m.native_provider,rampex_provider:m.rampex_provider,mode:'live',account_tag:require('../lib/gateway-config').configuration(m.native_provider,env).account_tag,countries:m.countries})):table==='commerce_delivery_options'?require('../config/delivery-options.json'):table==='commerce_partner_codes'?(partner?{partner_id:partner.customer_id}:null):table==='commerce_partners'?partner:table==='commerce_referrals'?existingReferral:table==='commerce_payment_methods'?paymentMethods:table==='commerce_memberships'?(membership?[membership]:[]):table==='commerce_balance_accounts'?balance:table==='commerce_invoices'?existing:[];
  const q={select(){return q;},eq(){return q;},in(){return q;},ilike(){return q;},is(){return q;},lte(){return q;},gt(){return q;},order(){return q;},limit(){return q;},maybeSingle(){return q;},then(resolve,reject){return Promise.resolve({data:value}).then(resolve,reject);}};return q;},rpc:async(name,args)=>{calls.push({name,args});return{data:{id,status:'accepted'}};}};
}
const request=(b,headers={})=>({method:'POST',headers:{origin:env.SITE_URL,'content-type':'application/json',authorization:'Bearer fixture-auth-token-long-enough',...headers},body:b});
async function call(b,{db=dbMock(),cat=catalog,params='',headers={}}={}){const res=response();await checkout.handle(request(b,headers),res,new URLSearchParams(params),{env,db,catalog:cat,rateLimit:async()=>{}});return{res,db};}

test('checkout quotes work on both verified domains without placing orders',async()=>{
 for(const configured of ['https://getpurelabs.com','https://altapurelabs.com'])for(const origin of ['https://getpurelabs.com','https://altapurelabs.com']){
  const db=dbMock(),res=response();await checkout.handle(request({...body,action:'quote'},{origin}),res,new URLSearchParams(),{env:{...env,SITE_URL:configured},db,catalog,rateLimit:async()=>{}});
  assert.equal(res.code,200);assert.equal(db.calls.length,0);
 }
});
test('authoritative catalog ignores client prices and retired volume/referral discounts while applying verified BLACK benefits',async()=>{
 for(const qty of [1,2,10,25,50]){
  const record=await checkout.normalize({},user,{...body,items:[{...body.items[0],qty}]},catalog);
  const q=checkout.price(record,method,{plan:'elite',invoice_id:id},{points:0,credit_cents:0},{customer_id:uid,code:'PARTNER',first_order:true});
  const rate=.10;assert.equal(q.subtotal_cents,qty*10000);assert.equal(q.discount_cents,qty*10000*rate);assert.equal(q.earned_points,qty*10000*(1-rate)/10);
  assert.equal(q.total_cents,qty*10000*(1-rate));assert.equal(q.membership_invoice_id,id);
  assert.equal(q.pricing.lines[0].qty,qty);assert.equal(q.pricing.lines[0].unit_price_cents,10000);
  assert.equal(q.pricing.lines[0].bogo_free_units,0);assert.deepEqual(q.pricing.referral,{partner_id:uid,code:'PARTNER',first_order:true});assert.equal(q.pricing.payment_discount,undefined);
 }
});
test('existing points and store credit remain payment value without changing regular source prices',async()=>{
 const record=await checkout.normalize({},user,{...body,points:500,credit_cents:1000},catalog);
 const q=checkout.price(record,method,null,{points:600,credit_cents:1200});
 assert.equal(q.total_cents,9995);assert.equal(q.discount_cents,0);assert.equal(q.earned_points,0);
 assert.equal(q.points_redeemed,500);assert.equal(q.credit_redeemed_cents,1000);
 assert.throws(()=>checkout.price(record,method,null,{points:499,credit_cents:1200}),/available/);
 assert.throws(()=>checkout.price(record,method,null,{points:600,credit_cents:999}),/credit/);
 for(const points of [1,99]){
  const r=await checkout.normalize({},user,{...body,points},catalog);assert.throws(()=>checkout.price(r,method,null,{points:1000,credit_cents:0}),/at least 100/);
 }
 const over=await checkout.normalize({},user,{...body,points:10001},catalog);
 assert.throws(()=>checkout.price(over,method,null,{points:20000,credit_cents:0}),/merchandise only/);
});
test('BLACKFRIDAY15 is normalized and cart, quote and persisted order have identical canonical prices',async()=>{
 const cat=[{id:'a',name:'A',variants:[{size:'5mg',price:19.99}]},{id:'b',name:'B',variants:[{size:'10mg',price:30.01}]}];
 const b={...body,coupon:' blackFriday15 ',items:[{id:'a',size:'5mg',qty:2,price:0},{id:'b',size:'10mg',qty:1,price:0}],total_cents:1,pricing:{discount_cents:999999}};
 const {res:quoted,db}=await call({...b,action:'quote'},{cat});assert.equal(quoted.code,200);
 assert.equal(quoted.body.subtotal_cents,6999);assert.equal(quoted.body.discount_cents,1050);assert.equal(quoted.body.total_cents,7444);
 assert.deepEqual(quoted.body.pricing.lines.map(x=>x.coupon_discount_cents),[600,450]);
 const {res:cart}=await call({...b,country:'US'},{db,cat,params:'checkout=cart',headers:{authorization:''}});
 assert.equal(cart.code,200);assert.deepEqual(cart.body.pricing,quoted.body.pricing);assert.equal(db.calls.length,0);
 const {res:placed}=await call({...b,action:'place',quote:quoted.body.quote},{db,cat});assert.equal(placed.code,201);assert.equal(db.calls.length,1);
 const saved=db.calls[0].args.p_data;assert.equal(db.calls[0].name,'commerce_place_checkout');
 assert.deepEqual(saved.pricing,quoted.body.pricing);assert.equal(saved.total_cents,quoted.body.total_cents);
 assert.equal(saved.request.checkout.coupon,'BLACKFRIDAY15');assert.deepEqual(saved.request.items.map(x=>x.qty),[2,1]);
 assert.equal(saved.checkout_version,config.version);assert.equal(saved.earned_points,0);
});
test('removing the explicit coupon restores regular price and invalidates the prior quote',async()=>{
 const b={...body,coupon:'BLACKFRIDAY15',items:[{...body.items[0],qty:2}]};
 const {res:q,db}=await call({...b,action:'quote'});assert.equal(q.body.discount_cents,3000);assert.equal(q.body.total_cents,17000);
 const {res:r}=await call({...b,coupon:'',action:'quote'},{db});assert.equal(r.body.discount_cents,0);assert.equal(r.body.total_cents,20000);
 const {res:stale}=await call({...b,coupon:'',action:'place',quote:q.body.quote},{db});assert.equal(stale.code,409);assert.equal(db.calls.length,0);
});
test('US standard shipping threshold uses discounted merchandise before account balances',async()=>{
 for(const [cents,coupon,shipping] of [[14999,'',1195],[15000,'',0],[17646,'BLACKFRIDAY15',1195],[17647,'BLACKFRIDAY15',0]]){
  const cat=[{...catalog[0],variants:[{size:'5mg',price:cents/100}]}];
  const r=await checkout.normalize({},user,{...body,coupon,points:500,credit_cents:1000},cat),q=checkout.price(r,method,null,{points:1000,credit_cents:2000});
  assert.equal(q.shipping_cents,shipping,'subtotal '+cents+' '+coupon);assert.equal(q.total_cents,cents-Math.round(cents*(coupon?0.15:0))+shipping-1500);
 }
});
test('coupon does not make express, international shipping, priority or protection free',async()=>{
 for(const [country,shipping,extras,expected] of [['US','standard',['protection'],500],['US','express',['protection'],3495],['US','next_day',['priority','protection'],7494],['CA','standard',[],0],['CA','next_day',[],6495],['CA','next_day',['protection'],6995],['GB','express',[],7995]]){
  const r=await checkout.normalize({},user,{...body,coupon:'BLACKFRIDAY15',items:[{...body.items[0],qty:2}],address:{...body.address,country},delivery:{shipping,extras}},catalog);
  assert.equal(checkout.price(r,method,null,{points:0,credit_cents:0}).shipping_cents,expected);
 }
 for(const country of ['ZZ','RU','GB']){
  const r=await checkout.normalize({},user,{...body,address:{...body.address,country},delivery:{shipping:'next_day',extras:[]}},catalog);
  assert.throws(()=>checkout.price(r,method,null,{points:0,credit_cents:0}),/unavailable|not available/);
 }
});
test('removed coupons, unsupported membership routes and forged program flags are blocked before any writes',async()=>{
 for(const params of ['','checkout=cart'])for(const action of ['quote','place'])for(const extra of [{kind:'membership',plan:'vip'},{plan:'elite'},{billing_period:'annual'},{research_builder:true},{subscription:true}]){
  const {res,db}=await call({...body,action,...extra},{params});assert.ok([400,409].includes(res.code));assert.equal(db.calls.length,0);
 }
 for(const coupon of ['BOGO','AP-ABCDEFGH2345','WELCOME10'])for(const params of ['','checkout=cart']){
  const {res,db}=await call({...body,action:'quote',coupon},{params});assert.equal(res.code,400);assert.equal(db.calls.length,0);
 }
});
test('Bulk Orders save 20% on 10-49 total units and 50% on 50+; no small-order quantity tier',async()=>{
 for(const qty of [1,9,10,49,50]){
  const b={...body,bulk_order:true,items:[{...body.items[0],qty}],delivery:{shipping:'express',extras:[]}};
  const {res:q,db}=await call({...b,action:'quote'});
  assert.equal(q.code,200);
  const tier=qty>=50?.5:qty>=10?.2:0;
  const discount=Math.round(qty*10000*tier);
  assert.equal(q.body.discount_cents,discount);
  assert.equal(q.body.shipping_cents,2995);
  assert.equal(q.body.total_cents,qty*10000-discount+2995);
  assert.equal(q.body.pricing.lines[0].qty,qty);
  if(qty>=10){
   assert.equal(q.body.pricing.quantity_discount_version,'pure-bulk-2026-11-v1');
   assert.equal(q.body.pricing.bulk_unit_count,qty);
   assert.equal(q.body.pricing.lines[0].discount_bps,qty>=50?5000:2000);
  }else assert.equal(q.body.pricing.quantity_discount_version,undefined);
  const {res:p}=await call({...b,coupon:'BLACKFRIDAY15',points:100,credit_cents:500,action:'quote'},{db});
  assert.equal(p.code,200);
  const expected=qty*10000*(qty>=10?tier:.15);
  assert.equal(p.body.discount_cents,expected);
  assert.equal(p.body.total_cents,qty*10000-expected+2995-600);
  assert.equal(db.calls.length,0);
 }
});
test('mixed-strength bulk totals unlock tiers on combined units, without extra Crypto stack',async()=>{
 const cat=[catalog[0],{id:'fixture-two',name:'Second compound',variants:[{size:'10mg',price:80}]}];
 for(const [a,b,rate] of [[6,4,2000],[35,15,5000]]){
  const list=[{id:cat[0].id,size:'5mg',qty:a},{id:cat[1].id,size:'10mg',qty:b}];
  const order={...body,bulk_order:true,items:list,delivery:{shipping:'express',extras:[]}};
  const rec=await checkout.normalize({},user,order,cat);
  const q=checkout.price(rec,method,null,{points:0,credit_cents:0});
  const gross=[10000*a,8000*b];
  const savings=gross.reduce((n,x)=>n+Math.round(x*rate/10000),0);
  assert.equal(q.discount_cents,savings);
  assert.deepEqual(q.pricing.lines.map(x=>x.discount_bps),[rate,rate]);
  assert.equal(q.pricing.bulk_unit_count,a+b);
  const crypto=checkout.price(rec,{...method,native_provider:'polygon_usdc',rampex_provider:null},null,{points:0,credit_cents:0});
  assert.equal(crypto.discount_cents,savings);
  assert.equal(crypto.pricing.crypto_discount_cents,0);
  assert.equal(crypto.pricing.crypto_discount_eligible,false);
 }
});
test('modified totals, quantities, delivery, prices and old version quotes fail before placement',async()=>{
 const {res:q,db}=await call({...body,action:'quote'});
 const changes=[{body:{items:[{...body.items[0],qty:2}]}},{body:{coupon:'BLACKFRIDAY15'}},{body:{delivery:{shipping:'express',extras:[]}}},{body:{quote:'0'.repeat(64)}},{cat:[{...catalog[0],variants:[{size:'5mg',price:101}]}]}];
 for(const change of changes){const {res}=await call({...body,action:'place',quote:q.body.quote,...change.body},{db,cat:change.cat||catalog});assert.equal(res.code,409);}
 for(const version of ['checkout-2026-11-v1','checkout-2026-11-v2','checkout-2026-11-v3','checkout-2026-11-v4','checkout-2026-11-v5','checkout-2026-11-v6']){
  const {res}=await call({...body,action:'place',quote:q.body.quote,checkout_version:version},{db});assert.equal(res.code,400);
 }
 assert.equal(db.calls.length,0);
});
test('completed request replay returns its existing order without a second debit',async()=>{
 const normalized=await checkout.normalize({},user,body,catalog);
 const db=dbMock({existing:{id,status:'accepted',request_digest:normalized.digest,checkout_version:config.version}});
 const {res}=await call({...body,action:'place',quote:'old'},{db});assert.equal(res.code,200);assert.equal(res.body.replayed,true);assert.equal(db.calls.length,0);
 const {res:conflict}=await call({...body,action:'place',points:100},{db});assert.equal(conflict.code,409);
});
test('authentication, origin, malformed cart and credit issuance fail closed',async()=>{
 for(const headers of [{authorization:''},{origin:'https://untrusted.example'}]){const {res,db}=await call({...body,action:'quote'},{headers});assert.ok([401,403].includes(res.code));assert.equal(db.calls.length,0);}
 for(const items of [[{...body.items[0],qty:0}],[{...body.items[0],qty:101}],[{...body.items[0],qty:1.5}],[body.items[0],body.items[0]],[{...body.items[0],size:'unknown'}]]){
  const {res,db}=await call({...body,items,action:'quote'});assert.equal(res.code,400);assert.equal(db.calls.length,0);
 }
 const {res,db}=await call({action:'issue_credit',id,customer_id:uid,amount_cents:100},{params:'checkout=admin'});assert.equal(res.code,401);assert.equal(db.calls.length,0);
});
test('public preview needs no card processor and public/account terms expose current PURE plans',async()=>{
 const db=dbMock({paymentMethods:[]});const {res}=await call({...body,country:'CA',delivery:{shipping:'standard',extras:['protection']}},{db,params:'checkout=cart',headers:{authorization:''}});
 assert.equal(res.code,200);assert.equal(res.body.total_cents,14495);assert.equal(db.calls.length,0);
 for(const params of ['checkout=public','']){const r=response();await checkout.handle({method:'GET',headers:{authorization:'Bearer fixture-auth-token-long-enough'}},r,new URLSearchParams(params),{env,db,catalog});
  assert.equal(r.code,200);assert.equal(r.body.terms.memberships,undefined);assert.equal(r.body.terms.membership_days,undefined);assert.equal(r.body.terms.renewal,undefined);
  assert.equal(r.body.terms.conversion.plans.vip.name,'PURE WHITE');assert.equal(r.body.terms.conversion.plans.elite.name,'PURE BLACK');assert.equal(r.body.terms.conversion.automatic_renewal,false);assert.equal(r.body.config.points_per_dollar,0);
 }
});

test('signed partner attribution and existing commissions do not add a customer discount',async()=>{
 const partners=require('../lib/partner-program');
 const partner={customer_id:'c0000000-0000-4000-8000-000000000004',code:'AP-ABCDEFGH2345',status:'active'};
 const cookie='ap_ref='+partners.cookieToken(partner.code,env.CHECKOUT_RATE_LIMIT_SECRET);
 for(const extra of [{},{coupon:'BLACKFRIDAY15'}]){
  const db=dbMock({partner}),{res}=await call({...body,action:'quote',...extra},{db,headers:{cookie}});
  assert.equal(res.code,200);assert.deepEqual(res.body.pricing.referral,{partner_id:partner.customer_id,code:partner.code,first_order:true});
  assert.equal(res.body.discount_cents,extra.coupon?1500:0);assert.equal(res.body.total_cents,extra.coupon?9695:11195);
 }
 const {res}=await call({...body,action:'quote'},{db:dbMock({partner}),headers:{cookie:cookie+'forged'}});
 assert.equal(res.code,200);assert.equal(res.body.pricing.referral,undefined);assert.equal(res.body.discount_cents,0);
 assert.equal(require('../config/conversion.json').partner.first_order_bps,2000);assert.equal(require('../config/conversion.json').partner.repeat_order_bps,1000);
 assert.equal(require('../config/conversion.json').partner.customer_discount_bps,0);
});
