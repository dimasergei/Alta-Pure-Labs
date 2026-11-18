const test=require('node:test'),assert=require('node:assert/strict');
const pricing=require('../lib/conversion-pricing'),partners=require('../lib/partner-program');
test('PURE memberships expose canonical prepaid terms and tier benefits without automatic renewal',()=>{
 const expected={vip:{name:'PURE WHITE',monthly:1999,annual:19190,discount_bps:500,points_per_dollar:5,priority:false,credit:0,gift:false},
  elite:{name:'PURE BLACK',monthly:9999,annual:95990,discount_bps:1000,points_per_dollar:10,priority:true,credit:5000,gift:true}};
 for(const [plan,values] of Object.entries(expected)){
  for(const period of ['monthly','annual'])assert.deepEqual(pricing.membershipItem(plan,period),{
   id:'membership-'+plan,name:values.name+' — '+period+' prepaid membership',size:period,qty:1,unit_price_usd_cents:values[period]});
  const benefits=pricing.planFor({plan});assert.equal(benefits.name,values.name);assert.equal(benefits.discount_bps,values.discount_bps);
  assert.equal(benefits.points_per_dollar,values.points_per_dollar);assert.equal(benefits.free_shipping,true);assert.equal(benefits.early_access,true);
  assert.equal(benefits.priority_fulfillment,values.priority);assert.equal(benefits.monthly_credit_cents,values.credit);assert.equal(benefits.free_bac_water_3ml,values.gift);
 }
 assert.equal(pricing.config.plans.elite.monthly_credit_min_order_cents,15000);
 assert.equal(pricing.config.memberships_enabled,true);assert.equal(pricing.config.billing_mode,'prepaid');
 assert.equal(pricing.config.recurring_available,false);assert.equal(pricing.config.automatic_renewal,false);
 for(const plan of ['member','unknown','__proto__'])assert.throws(()=>pricing.membershipItem(plan,'monthly'),e=>e.status===400);
 for(const period of ['weekly','subscription',null])assert.throws(()=>pricing.membershipItem('vip',period),e=>e.status===400);
});
test('verified membership tiers determine shipping and integer points earnings',()=>{
 assert.equal(pricing.shipping(14999,null),1495);assert.equal(pricing.shipping(15000,null),0);
 assert.equal(pricing.earnings(99999,null),0);
 for(const [plan,points] of [['vip',4999],['elite',9999]]){
  assert.equal(pricing.shipping(14999,{plan}),0);assert.equal(pricing.shipping(15000,{plan}),0);
  assert.equal(pricing.earnings(99999,{plan}),points);assert.equal(pricing.earnings(-1,{plan}),0);
 }
 assert.equal(pricing.bankLabel({kind:'bank_transfer'}),'Same-day bank transfer');
});
test('referral attribution cookies cannot be forged, expired, future dated or signed with another key',()=>{
 const secret='fixture-secret-with-at-least-32-characters',now=1794400000000,code='AP-ABCDEFGH2345';
 const value=partners.cookieToken(code,secret,now);
 assert.equal(partners.readCookie('ap_ref='+value,secret,now),code);
 assert.equal(partners.readCookie('ap_ref='+value,secret+'x',now),null);
 assert.equal(partners.readCookie('ap_ref='+value,secret,now+31*86400000),null);
 assert.equal(partners.readCookie('ap_ref='+value,secret,now-1000),null);
 assert.equal(partners.readCookie('ap_ref='+value.replace('ABCD','WXYZ'),secret,now),null);
});
test('partner admin payout endpoint rejects missing admin authentication before any write',async()=>{
 let called=false;const db={rpc(){called=true;throw Error('unexpected');}};
 const res={setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;}};
 await partners.handle({method:'POST',headers:{origin:'https://example.test','content-type':'application/json'},body:{action:'record_payout'}},res,new URLSearchParams('partner=admin'),{db,env:{SITE_URL:'https://example.test',ADMIN_ORDERS_PASSWORD:'a'.repeat(32)}});
 assert.equal(res.code,401);assert.equal(called,false);
});
