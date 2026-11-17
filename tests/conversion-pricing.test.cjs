const test=require('node:test'),assert=require('node:assert/strict');
const pricing=require('../lib/conversion-pricing'),partners=require('../lib/partner-program');
test('memberships are unavailable; shipping and earning have no membership benefit',()=>{
 for(const plan of ['vip','elite'])for(const period of ['monthly','annual'])assert.throws(()=>pricing.membershipItem(plan,period),e=>e.status===409);
 for(const membership of [null,{plan:'vip'},{plan:'elite'}]){
  assert.equal(pricing.shipping(14999,membership),1495);assert.equal(pricing.shipping(15000,membership),0);
  assert.equal(pricing.earnings(99999,membership),0);
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
