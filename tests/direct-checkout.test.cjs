'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const checkout=require('../lib/direct-checkout'),config=require('../config/checkout.json');
const id='c0000000-0000-4000-8000-000000000001',uid='c0000000-0000-4000-8000-000000000002',mid='c0000000-0000-4000-8000-000000000003';
const user={id:uid,email:'customer@example.test',email_confirmed_at:'2026-01-01'};
const method={id:mid,active:true,kind:'bank_transfer',version:1,currency:'USD',sale_scope:'both',label:'Bank transfer'};
const catalog=[{id:'fixture-product',name:'Fixture product',variants:[{size:'5mg',price:100}]}];
const body={id,kind:'goods',method_id:mid,consent:true,checkout_version:config.version,items:[{id:'fixture-product',size:'5mg',qty:1,price:0.01}],name:'Customer',organization:'Lab',address:{line1:'123 Fixture Street',city:'Fixture City',region:'FL',postal_code:'34287',country:'US'},research_use:true};
const env={SITE_URL:'https://altapurelabs.com',ADMIN_ORDERS_PASSWORD:'x'.repeat(40)};
function response(){return{code:200,setHeader(){},status(n){this.code=n;return this;},json(b){this.body=b;return this;}};}
function dbMock({balance={points:1000,credit_cents:5000},membership=null,existing=null}={}){
 const calls=[];return{calls,auth:{getUser:async()=>({data:{user}})},from(table){const value=table==='commerce_payment_methods'?[method]:table==='commerce_memberships'?(membership?[membership]:[]):table==='commerce_balance_accounts'?balance:table==='commerce_invoices'?existing:[];
  const q={select(){return q;},eq(){return q;},is(){return q;},lte(){return q;},gt(){return q;},order(){return q;},limit(){return q;},maybeSingle(){return q;},then(resolve,reject){return Promise.resolve({data:value}).then(resolve,reject);}};return q;},rpc:async(name,args)=>{calls.push({name,args});return{data:{id,status:'accepted'}};}};
}
const request=(b,headers={})=>({method:'POST',headers:{origin:env.SITE_URL,'content-type':'application/json',authorization:'Bearer fixture-auth-token-long-enough',...headers},body:b});
test('authoritative catalog ignores client prices; member/volume then bank discount are server-selected',async()=>{
 const r=await checkout.normalize({},user,body,catalog);const p=checkout.price(r,method,{plan:'elite',invoice_id:id},{points:0,credit_cents:0});
 assert.equal(p.subtotal_cents,10000);assert.equal(p.discount_cents,1450);assert.equal(p.total_cents,11050);assert.equal(p.earned_points,85);
 assert.equal(r.request.items[0].unit_price_usd_cents,10000);
});
test('points and credit reduce payable and earning base without changing source prices',async()=>{
 const r=await checkout.normalize({},user,{...body,points:500,credit_cents:1000},catalog);const p=checkout.price(r,method,null,{points:600,credit_cents:1200});
 assert.equal(p.total_cents,10500);assert.equal(p.earned_points,80);assert.equal(p.points_redeemed,500);assert.equal(p.credit_redeemed_cents,1000);
 assert.throws(()=>checkout.price(r,method,null,{points:499,credit_cents:1200}),/available/);
 assert.throws(()=>checkout.price(r,method,null,{points:600,credit_cents:999}),/credit/);
});
test('small redemptions, negative points debt, non-US shipping and membership credit are rejected',async()=>{
 for(const delta of [{points:50},{points:100,credit_cents:20000},{address:{...body.address,country:'CA'}}]){
  const r=await checkout.normalize({},user,{...body,...delta},catalog);assert.throws(()=>checkout.price(r,method,null,{points:1000,credit_cents:50000}));
 }
 const r=await checkout.normalize({},user,{...body,points:100},catalog);assert.throws(()=>checkout.price(r,method,null,{points:-10,credit_cents:0}));
 const m=await checkout.normalize({},user,{...body,kind:'membership',plan:'vip',credit_cents:100},catalog);assert.throws(()=>checkout.price(m,method,null,{points:0,credit_cents:1000}));
});
test('quote cannot place an order; stale or modified quote cannot charge or spend',async()=>{
 const db=dbMock(),res=response();await checkout.handle(request({...body,action:'quote'}),res,new URLSearchParams(),{env,db,catalog,rateLimit:async()=>{}});
 assert.equal(res.code,200);assert.equal(db.calls.length,0);assert.match(res.body.quote,/^[a-f0-9]{64}$/);
 const denied=response();await checkout.handle(request({...body,action:'place',quote:'invented'}),denied,new URLSearchParams(),{env,db,catalog,rateLimit:async()=>{}});assert.equal(denied.code,409);assert.equal(db.calls.length,0);
 const placed=response();await checkout.handle(request({...body,action:'place',quote:res.body.quote}),placed,new URLSearchParams(),{env,db,catalog,rateLimit:async()=>{}});assert.equal(placed.code,201);assert.equal(db.calls.length,1);assert.equal(db.calls[0].name,'commerce_place_checkout');assert.equal(db.calls[0].args.p_data.customer_id,uid);
});
test('completed request replay returns its order without a second debit or re-pricing',async()=>{
 const r=await checkout.normalize({},user,body,catalog),db=dbMock({existing:{id,status:'paid',request_digest:r.digest,checkout_version:config.version}}),res=response();
 await checkout.handle(request({...body,action:'place',quote:'old-quote'}),res,new URLSearchParams(),{env,db,catalog,rateLimit:async()=>{}});assert.equal(res.code,200);assert.equal(res.body.replayed,true);assert.equal(db.calls.length,0);
});
test('auth, origin and admin credit issuance fail closed',async()=>{
 for(const [headers,code] of [[{authorization:''},401],[{origin:'https://evil.test'},403],[{'content-type':'text/plain'},415]]){
  const r=response();await checkout.handle(request({...body,action:'place'},headers),r,new URLSearchParams(),{env,db:dbMock()});assert.equal(r.code,code);
 }
 const r=response();await checkout.handle(request({action:'issue_credit'}),r,new URLSearchParams({checkout:'admin'}),{env,db:dbMock()});assert.equal(r.code,401);
 assert.equal(checkout.usable({...method,native_provider:'nmi'},{}),false);
 assert.equal(checkout.usable({...method,kind:'hosted_link'},{}),false);
});
