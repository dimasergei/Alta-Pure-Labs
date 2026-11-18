'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {issueInvoice}=require('../lib/manual-commerce');
const multi=require('../lib/multi-payment-commerce');
const id='b0000000-0000-4000-8000-000000000001',uid='b0000000-0000-4000-8000-000000000002',mid='b0000000-0000-4000-8000-000000000003';
const method={id:mid,kind:'interac',provider_key:'interac',native_provider:null,currency:'CAD',label:'Fixture Interac',active:true,version:3,sale_scope:'goods'};
const invoice={id,customer_id:uid,kind:'goods',status:'requested',version:1,checkout_version:null,request_data:{
 address:{country:'CA',region:'ON'},items:[{id:'fixture',name:'Fixture product',size:'5mg',qty:1,unit_price_usd_cents:6000}],
 preferred_payment:{method_id:mid,provider_key:'interac',label:method.label,currency:'CAD'},
 checkout:{payment_kind:'interac',request_only:true,payment_method_version:3,points:0,credit_cents:0,coupon:'BLACKFRIDAY15',delivery:{shipping:'standard',extras:[]},usd_estimate:{currency:'USD',total_cents:9095}}
}};
const review={confirmed:true,seller_name:'Fixture corporation',destination_country:'CA',destination_region:'ON',tax_mode:'canada_taxable_goods',tax_basis:'Fixture reviewed Canadian taxable supply.',components:[],jurisdictions_reviewed:true,
 canada_supply_confirmed:true,gst_hst_number:'123456789RT0001',shipping_taxable:true,
 delivery:{origin_country:'CA',origin_region:'ON',carrier:'Fixture carrier',service:'Ground',quote_reference:'Fixture reviewed quote',quote_expires_at:'2099-01-01',handling_max_days:2,transit_min_days:2,transit_max_days:5,duties:'domestic',route_review:'Fixture destination and goods reviewed.'}};
const input={id,action:'preview',version:1,method_id:mid,expected_method_version:3,fx_ppm:1375000,shipping_cents:1000,delivery_tax:review,fulfillment_confirmed:true,review_note:'Fixture exchange rate, goods, shipping and tax reviewed.'};
function database(r=invoice,m=method){
 const calls=[],reads=[];
 return{calls,reads,from(table){reads.push(table);assert.ok(['commerce_invoices','commerce_payment_methods'].includes(table));const q={select(){return q;},eq(){return q;},single:async()=>({data:structuredClone(table==='commerce_invoices'?r:m)})};return q;},rpc:async(name,args)=>{
  calls.push({name,args});assert.equal(name,'commerce_provider_command');assert.equal(args.p_action,'issue');return{data:{id,status:'issued'}};
 }};
}

test('reviewed CAD invoice converts catalog units, preserves saved coupon, and computes tax on discounted merchandise and delivery',async()=>{
 const db=database(),out=await issueInvoice(db,input);
 assert.equal(out.currency,'CAD');assert.equal(out.fx_ppm,1375000);assert.equal(out.subtotal_cents,8250);assert.equal(out.discount_cents,1238);
 assert.equal(out.pricing.coupon_code,'BLACKFRIDAY15');assert.equal(out.pricing.coupon_discount_cents,1238);assert.equal(out.pricing.lines[0].line_total_cents,7012);
 assert.equal(out.pricing.delivery_tax.taxes[0].taxable_cents,8012);assert.equal(out.tax_cents,1042);assert.equal(out.shipping_cents,1000);assert.equal(out.total_cents,9054);
 assert.equal(out.checkout_version,undefined);assert.equal(out.payment_url,null);assert.equal(out.pricing.payment_discount,undefined);assert.equal(out.pricing.crypto_discount_cents,undefined);assert.equal(db.calls.length,0);
 const issued=await issueInvoice(db,{...input,action:'issue',expected_total_cents:9054});assert.equal(issued.total_cents,9054);assert.equal(db.calls.length,0);
});

test('invoice pricing uses only the saved valid coupon; client discount fields cannot alter it',async()=>{
 const forged={...input,coupon:'FAKE',discount_cents:999999,pricing:{discount_cents:999999},total_cents:1,payment_discount:{amount_cents:999999},tax_cents:0};
 assert.equal((await issueInvoice(database(),forged)).total_cents,9054);
 const noCoupon=structuredClone(invoice);noCoupon.request_data.checkout.coupon='';
 const regular=await issueInvoice(database(noCoupon),{...forged,coupon:'BLACKFRIDAY15'});
 assert.equal(regular.discount_cents,0);assert.equal(regular.tax_cents,1203);assert.equal(regular.total_cents,10453);
 const stale=structuredClone(invoice);stale.request_data.checkout.coupon='RETIRED';
 await assert.rejects(issueInvoice(database(stale),input),e=>e.status===400&&/coupon/i.test(e.message));
});

test('CAD Interac requires an explicit fixed rate and current invoice/method/total review',async()=>{
 for(const fx_ppm of [undefined,null,NaN,1.375,0,99999,10000001,'1375000'])await assert.rejects(issueInvoice(database(),{...input,fx_ppm}),e=>e.status===400);
 for(const change of [{version:2},{expected_method_version:2},{expected_method_version:'3'},{action:'issue',expected_total_cents:1},{action:'issue'}])await assert.rejects(issueInvoice(database(),{...input,...change}),e=>e.status===409);
 await assert.rejects(issueInvoice(database({...invoice,status:'issued'}),input),e=>e.status===409);
 await assert.rejects(issueInvoice(database(invoice,{...method,active:false}),input),e=>e.status===409);
});

test('requested Interac cannot be switched to another method, currency, gateway or destination, or spend USD balances',async()=>{
 for(const change of [{id:'b0000000-0000-4000-8000-000000000009'},{currency:'USD'},{kind:'bank_transfer'},{provider_key:'bank_transfer'},{native_provider:'rampex'},{native_provider:'polygon_usdc'}]){
  await assert.rejects(issueInvoice(database(invoice,{...method,...change}),input),e=>e.status===409,JSON.stringify(change));
 }
 for(const mutate of [r=>r.request_data.address.country='US',r=>r.request_data.preferred_payment.currency='USD',r=>delete r.request_data.preferred_payment,
  r=>r.request_data.checkout.points=100,r=>r.request_data.checkout.credit_cents=1]){
  const changed=structuredClone(invoice);mutate(changed);await assert.rejects(issueInvoice(database(changed),input),e=>e.status===409);
 }
});

test('final CAD invoice still requires the complete shipping, fulfillment and tax review',async()=>{
 for(const change of [{fulfillment_confirmed:false},{review_note:''},{delivery_tax:null},{delivery_tax:{...review,confirmed:false}},
  {delivery_tax:{...review,destination_region:'BC'}},{delivery_tax:{...review,jurisdictions_reviewed:false}},
  {delivery_tax:{...review,delivery:{...review.delivery,quote_expires_at:'2000-01-01'}}}]){
  await assert.rejects(issueInvoice(database(),{...input,...change}),e=>e.status===400);
 }
});

test('authenticated issue uses the existing version-bound provider command and persists only reviewed CAD amounts',async()=>{
 const env={SITE_URL:'https://getpurelabs.com',ADMIN_ORDERS_PASSWORD:'isolated-admin-fixture-'.repeat(3)},db=database();
 const res={code:200,setHeader(){},status(n){this.code=n;return this;},json(value){this.body=value;return this;}};
 await multi.handle({method:'POST',headers:{origin:env.SITE_URL,'content-type':'application/json','x-admin-password':env.ADMIN_ORDERS_PASSWORD},body:{...input,action:'issue',expected_total_cents:9054}},res,new URLSearchParams({commerce:'admin'}),{env,db});
 assert.equal(res.code,200);assert.equal(res.body.status,'issued');assert.equal(db.calls.length,1);
 const saved=db.calls[0].args.p_data;assert.equal(saved.method_version,3);assert.equal(saved.provider_key,'interac');assert.equal(saved.currency,'CAD');assert.equal(saved.total_cents,9054);assert.equal(saved.discount_cents,1238);assert.equal(saved.payment_url,null);assert.equal(saved.checkout_version,undefined);
});
