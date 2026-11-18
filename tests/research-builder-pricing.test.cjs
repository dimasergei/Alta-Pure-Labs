'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const builder=require('../lib/research-builder-pricing'),handler=require('../lib/research-builder-handler');

const source=[40.01,70.02,90.03,100.04,120].map((price,index)=>({id:'compound-'+index,name:'Compound '+index,category:'injectables',group:'Research',supplier_secret:'private',variants:[{size:'5mg',price,cost:1},{size:'10mg',price:Math.round((price+25)*100)/100}]})).concat([
 {id:'bac-water',name:'BAC Water',category:'supplies',variants:[{size:'3mL',price:14.95}]},
 {id:'oral-fixture',name:'Oral fixture',category:'oral',variants:[{size:'30 capsules',price:40}]}
]);
const items=source.slice(0,4).map(product=>({id:product.id,size:'5mg',qty:1}));
const origin='https://pure.example',token='fixture_verified_member_token_1234',customer='fixture-customer';
function response(){return{headers:{},setHeader(name,value){this.headers[name]=value;},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};}
async function request({method='POST',headers={},body={action:'quote',items},query,db}={}){
 const res=response();await handler({method,headers:{origin,'content-type':'application/json',...headers},body,query},res,{catalog:source,env:{SITE_URL:origin},db});return res;
}
function database({plan='vip',user={id:customer,email_confirmed_at:'2026-01-01'},authError=null,errorTable=null,invoiceOverrides={},subscriptions=[]}={}){
 const calls=[],now=Date.now();
 const rows={commerce_memberships:plan?[{invoice_id:'membership-source',customer_id:customer,plan,starts_at:new Date(now-86400000).toISOString(),expires_at:new Date(now+86400000).toISOString(),revoked_at:null}]:[],
  commerce_invoices:[{id:'membership-source',customer_id:customer,kind:'membership',plan,status:'paid',request_data:{billing_period:'monthly'},...invoiceOverrides}],research_subscriptions:subscriptions};
 const db={auth:{getUser:async value=>{calls.push({auth:value});return{data:{user},error:authError};}},from(table){
  const call={table,filters:[]};calls.push(call);let data=rows[table]||[];
  const query={select(columns){call.select=columns;return this;},eq(key,value){call.filters.push(['eq',key,value]);data=data.filter(row=>row[key]===value);return this;},
   is(key,value){call.filters.push(['is',key,value]);data=data.filter(row=>row[key]===value);return this;},
   lte(key,value){call.filters.push(['lte',key,value]);data=data.filter(row=>row[key]<=value);return this;},
   gt(key,value){call.filters.push(['gt',key,value]);data=data.filter(row=>row[key]>value);return this;},
   in(key,values){call.filters.push(['in',key,values]);data=data.filter(row=>values.includes(row[key]));return this;},
   order(){return this;},limit(n){data=data.slice(0,n);return this;},then(resolve,reject){return Promise.resolve({data,error:errorTable===table?{message:'fixture database unavailable'}:null}).then(resolve,reject);}};
  return query;
 }};return{db,calls};
}

test('public builder catalog contains only injectable selections and public variant fields',async()=>{
 const catalog=builder.catalog(source);
 assert.equal(catalog.length,5);assert.ok(catalog.every(item=>item.category==='injectables'));
 assert.deepEqual(Object.keys(catalog[0]).sort(),['category','group','id','name','variants']);
 assert.deepEqual(catalog[0].variants,[{size:'5mg',price:40.01},{size:'10mg',price:65.01}]);
 const result=await request({method:'GET'});
 assert.equal(result.code,200);assert.deepEqual(result.body.catalog,catalog);
 assert.equal(result.body.one_time_available,true);assert.equal(result.body.subscription_available,false);
 assert.equal(result.body.terms.version,'research-builder-2026-11-v3');assert.equal(result.body.terms.minimum_paid_cycles,0);
 assert.equal(result.body.terms.cancel_after_paid_cycles,0);assert.equal(result.body.terms.change_after_first_shipment,false);
 assert.equal(result.body.terms.automatic_renewal,false);assert.equal(result.headers['Cache-Control'],'no-store');assert.equal(result.headers.Vary,'Authorization');
});

test('one-time research sets use canonical catalog prices without subscription benefits or customer supplied discounts',()=>{
 const forged=items.map(item=>({...item,name:'Forged name',unit_price_usd_cents:1,discount_bps:10000}));
 const quote=builder.quote(forged,source);
 assert.equal(quote.mode,'one_time');assert.equal(quote.currency,'USD');assert.equal(quote.subtotal_cents,30010);
 assert.equal(quote.total_cents,30010);assert.equal(quote.discount_cents,0);assert.equal(quote.minimum_paid_cycles,0);
 assert.equal(quote.monthly_cents,null);assert.equal(quote.bundled_item,null);assert.equal(quote.shipping_cents,null);assert.equal(quote.shipping_confirmed,false);
 assert.deepEqual(quote.lines.map(line=>line.name),source.slice(0,4).map(product=>product.name));
 assert.deepEqual(quote.lines.map(line=>line.unit_price_usd_cents),[4001,7002,9003,10004]);
});

test('member savings and explicit coupon compete on one-time sets; monthly terms remain a non-purchasable preview',()=>{
 for(const [plan,savings] of [['vip',1501],['elite',3001]]){
  const member=builder.quote(items,source,{membership:{plan}});
  assert.equal(member.membership_discount_cents,savings);assert.equal(member.total_cents,30010-savings);
  assert.equal(member.lines.reduce((sum,line)=>sum+line.membership_discount_cents,0),savings);
  const coupon=builder.quote(items,source,{membership:{plan},coupon:'BLACKFRIDAY15'});
  assert.equal(coupon.discount_cents,4502);assert.equal(coupon.membership_discount_cents,0);assert.equal(coupon.coupon_discount_cents,4502);assert.equal(coupon.total_cents,25508);
 }
 const preview=builder.quote(items,source,{mode:'subscription',membership:{plan:'elite'},coupon:'BLACKFRIDAY15'});
 assert.equal(preview.total_cents,18008);assert.equal(preview.discount_cents,12002);assert.equal(preview.monthly_cents,preview.total_cents);
 assert.equal(preview.minimum_paid_cycles,0);assert.equal(preview.shipping_cents,0);assert.equal(preview.shipping_confirmed,false);
 assert.equal(preview.bundled_item.id,'gift-bac-3');assert.equal(preview.subscription_available,false);assert.equal(preview.terms.automatic_renewal,false);
 assert.ok(preview.lines.every(line=>line.discount_reason==='research_subscription_preview'));
});

test('builder rejects incomplete, duplicate, non-injectable, invalid-quantity and nonexistent-size selections',()=>{
 const invalid=[undefined,[],items.slice(0,3),[...items,items[0]],[items[0],items[0],items[2],items[3]],
  items.map((item,index)=>index?item:{id:'bac-water',size:'3mL',qty:1}),items.map((item,index)=>index?item:{id:'oral-fixture',size:'30 capsules',qty:1}),
  ...[0,2,'1',null].map(qty=>items.map((item,index)=>index?item:{...item,qty})),items.map((item,index)=>index?item:{...item,size:'unknown'}),items.map((item,index)=>index?item:null)];
 for(const selection of invalid)assert.throws(()=>builder.quote(selection,source),error=>error.status===400);
 assert.throws(()=>builder.quote(items,source,{mode:'automatic'}),error=>error.status===400);
});

test('public quotes never trust a requested membership; authenticated quotes use the verified account entitlement',async()=>{
 const unsigned=database({plan:'elite'});
 const publicQuote=await request({db:unsigned.db,body:{action:'quote',items,membership:{plan:'elite'},plan:'elite'}});
 assert.equal(publicQuote.code,200);assert.equal(publicQuote.body.total_cents,30010);assert.equal(unsigned.calls.length,0);
 for(const [plan,total] of [['vip',28509],['elite',27009],[null,30010]]){
  const fixture=database({plan}),result=await request({headers:{authorization:'Bearer '+token},db:fixture.db});
  assert.equal(result.code,200);assert.equal(result.body.total_cents,total);assert.deepEqual(fixture.calls[0],{auth:token});
  assert.ok(fixture.calls.find(call=>call.table==='commerce_memberships').filters.some(filter=>filter[0]==='eq'&&filter[1]==='customer_id'&&filter[2]===customer));
 }
 for(const invoiceOverrides of [{customer_id:'another-customer'},{plan:'elite'},{kind:'goods'},{status:'refunded'}]){
  const fixture=database({invoiceOverrides}),result=await request({headers:{authorization:'Bearer '+token},db:fixture.db});
  assert.equal(result.code,200);assert.equal(result.body.membership_discount_cents,0);assert.equal(result.body.total_cents,30010);
 }
});

test('invalid or unverified sessions fail closed; an unavailable benefits source cannot silently promise member prices',async()=>{
 const malformed=database();assert.equal((await request({headers:{authorization:'Bearer short'},db:malformed.db})).code,401);assert.equal(malformed.calls.length,0);
 for(const options of [{authError:{message:'expired'}},{user:null},{user:{id:customer,email_confirmed_at:null}}]){
  const fixture=database(options),result=await request({headers:{authorization:'Bearer '+token},db:fixture.db});assert.equal(result.code,401);assert.equal(fixture.calls.length,1);
 }
 for(const errorTable of ['commerce_memberships','commerce_invoices']){
  const fixture=database({errorTable}),result=await request({headers:{authorization:'Bearer '+token},db:fixture.db});assert.equal(result.code,503);assert.match(result.body.error,/temporarily unavailable/);
 }
});

test('automatic enrollment and all mutation actions remain unavailable without any database writes',async()=>{
 const db={from(){throw Error('No database access permitted for a disabled mutation');},auth:{getUser(){throw Error('No authentication needed for a disabled mutation');}}};
 for(const action of ['create','checkout','edit','activate','renew','cancel','pause','resume']){
  const result=await request({db,headers:{authorization:'Bearer '+token},body:{action,items,mode:'subscription'}});assert.equal(result.code,409);assert.match(result.body.error,/Automatic monthly billing is not connected/);
 }
 const preview=await request({body:{action:'quote',items,mode:'subscription'}});assert.equal(preview.code,200);assert.equal(preview.body.subscription_available,false);
});

test('monthly quote API publishes flexible v3 terms without accepting client activation flags or stale minimums',async()=>{
 const result=await request({body:{action:'quote',items,mode:'subscription',minimum_paid_cycles:3,
  automatic_renewal:true,subscription_available:true,terms:{version:'research-builder-2026-11-v2',minimum_paid_cycles:3,cancel_after_paid_cycles:3,change_after_first_shipment:true}}});
 assert.equal(result.code,200);assert.equal(result.body.minimum_paid_cycles,0);
 assert.equal(result.body.terms.version,'research-builder-2026-11-v3');assert.equal(result.body.terms.minimum_paid_cycles,0);
 assert.equal(result.body.terms.cancel_after_paid_cycles,0);assert.equal(result.body.terms.change_after_first_shipment,false);
 assert.equal(result.body.terms.automatic_renewal,false);assert.equal(result.body.subscription_available,false);
 assert.equal(result.body.total_cents,18008);assert.equal(result.body.terms.discount_bps,4000);
 assert.match(result.body.reason,/does not create a subscription or charge/);
});

test('builder quote endpoint enforces origin, JSON, size, method and catalog validation',async()=>{
 for(const [options,status] of [[{headers:{origin:'https://untrusted.example'}},403],[{headers:{'content-type':'text/plain'}},415],
  [{body:'{invalid-json'},400],[{body:[]},400],[{body:{action:'quote',items:items.slice(0,3)}},400],[{body:{action:'quote',items,padding:'x'.repeat(33000)}},413]])assert.equal((await request(options)).code,status);
 const unsupported=await request({method:'DELETE'});assert.equal(unsupported.code,405);assert.equal(unsupported.headers.Allow,'GET, POST');
});

test('historical subscription reads require a verified account and remain scoped to that account with no renewal actions',async()=>{
 for(const scope of ['mine','admin'])assert.equal((await request({method:'GET',query:{scope}})).code,401);
 const denied=database({user:{id:customer,email_confirmed_at:null}});
 assert.equal((await request({method:'GET',query:{scope:'mine'},headers:{authorization:'Bearer '+token},db:denied.db})).code,401);assert.equal(denied.calls.length,1);
 const subscriptions=[{id:'owned-subscription',customer_id:customer,status:'canceled',minimum_paid_cycles:3,paid_cycles:2,research_subscription_cycles:[]},{id:'other-subscription',customer_id:'someone-else',status:'active'}];
 const fixture=database({subscriptions}),result=await request({method:'GET',query:{scope:'mine'},headers:{authorization:'Bearer '+token},db:fixture.db});
 assert.equal(result.code,200);assert.deepEqual(result.body.subscriptions.map(item=>item.id),['owned-subscription']);assert.deepEqual(result.body.subscriptions[0].actions,[]);
 assert.equal(result.body.subscriptions[0].currency,'USD');assert.equal(result.body.subscription_available,false);
 assert.equal(result.body.subscriptions[0].minimum_paid_cycles,3);assert.equal(result.body.subscriptions[0].paid_cycles,2);
 assert.ok(fixture.calls.find(call=>call.table==='research_subscriptions').filters.some(filter=>filter[1]==='customer_id'&&filter[2]===customer));
});
