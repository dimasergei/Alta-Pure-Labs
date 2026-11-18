'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const benefits=require('../lib/membership-benefits'),checkout=require('../lib/direct-checkout'),conversion=require('../lib/conversion-pricing');
const now=Date.parse('2026-11-18T12:00:00Z'),uid='c1000000-0000-4000-8000-000000000001',id='c1000000-0000-4000-8000-000000000002';
function db(rows,errors={}) {
  return {from(table){const filters=[];let limit=Infinity;const q={select(){return q;},eq(k,v){filters.push(x=>x[k]===v);return q;},
    is(k,v){filters.push(x=>x[k]===v);return q;},in(k,v){filters.push(x=>v.includes(x[k]));return q;},
    lte(k,v){filters.push(x=>x[k]<=v);return q;},gt(k,v){filters.push(x=>x[k]>v);return q;},order(){return q;},
    limit(n){limit=n;return q;},then(resolve,reject){return Promise.resolve({data:(rows[table]||[]).filter(x=>filters.every(f=>f(x))).slice(0,limit),error:errors[table]}).then(resolve,reject);}};return q;}};
}
const member={invoice_id:id,customer_id:uid,plan:'elite',starts_at:'2026-11-01T00:00:00Z',expires_at:'2026-12-01T00:00:00Z',revoked_at:null};
test('active benefits require a paid membership source and current unrevoked entitlement',async()=>{
  for(const source of [[],[{id,kind:'membership',status:'accepted'}],[{id,kind:'goods',status:'paid'}],[{id,kind:'membership',status:'refunded'}]])
    assert.equal(await benefits.active(db({commerce_memberships:[member],commerce_invoices:source}),uid,now),null);
  const source=[{id,customer_id:uid,plan:'elite',kind:'membership',status:'paid',request_data:{billing_period:'annual'}}];
  const verified=await benefits.active(db({commerce_memberships:[member],commerce_invoices:source}),uid,now);
  assert.equal(verified.plan,'elite');assert.equal(verified.billing_period,'annual');
  for(const patch of [{customer_id:'other'},{plan:'vip'}])
    assert.equal(await benefits.active(db({commerce_memberships:[member],commerce_invoices:[{...source[0],...patch}]}),uid,now),null);
  for(const patch of [{revoked_at:'2026-11-17T00:00:00Z'},{expires_at:'2026-11-18T11:59:59Z'},{starts_at:'2026-11-19T00:00:00Z'},{customer_id:'other'}])
    assert.equal(await benefits.active(db({commerce_memberships:[{...member,...patch}],commerce_invoices:source}),uid,now),null);
  await assert.rejects(benefits.active(db({commerce_memberships:[member]},{commerce_invoices:{message:'offline'}}),uid,now),e=>e.status===503);
});
test('pending fees expose only resumable current purchases, without awarding benefits',async()=>{
  const method={id:'c1000000-0000-4000-8000-000000000003',currency:'USD',kind:'hosted_link',native_provider:'rampex',sale_scope:'both'};
  const request={billing_period:'monthly',items:[conversion.membershipItem('vip','monthly')],address:{country:'US'},
    checkout:{version:'checkout-2026-11-v8',method_id:method.id,points:0,credit_cents:0,coupon:'',delivery:{shipping:'standard',extras:[]}}};
  const record={id,customer_id:uid,kind:'membership',plan:'vip',request};
  const fee={...record,...checkout.price(record,method,null,{points:0,credit_cents:0}),checkout_version:'checkout-2026-11-v8',request_data:request,status:'accepted',expires_at:'2026-11-19T12:00:00Z'};
  const result=await benefits.pending(db({commerce_invoices:[fee]}),uid,now);
  assert.deepEqual(result,{invoice_id:id,plan:'vip',name:'PURE WHITE',billing_period:'monthly',status:'accepted',currency:'USD',total_cents:1999,expires_at:fee.expires_at,expired:false,requires_review:false});
  assert.equal(result.benefits,undefined);assert.equal(result.pricing,undefined);assert.equal(result.request_data,undefined);
  for(const patch of [{status:'paid'},{status:'void'},{customer_id:'other'}])
    assert.equal(await benefits.pending(db({commerce_invoices:[{...fee,...patch}]}),uid,now),null);
  for(const patch of [{total_cents:1},{checkout_version:'checkout-2026-11-v7'}])
    assert.equal((await benefits.pending(db({commerce_invoices:[{...fee,...patch}]}),uid,now)).requires_review,true);
  assert.equal((await benefits.pending(db({commerce_invoices:[{...fee,expires_at:'2026-11-18T11:00:00Z'}]}),uid,now)).expired,true);
});
