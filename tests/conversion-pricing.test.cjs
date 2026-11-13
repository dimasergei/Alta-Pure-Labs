const test=require('node:test'),assert=require('node:assert/strict');
const pricing=require('../lib/conversion-pricing'),partners=require('../lib/partner-program');
test('membership prices, calendar periods, free shipping and earning rates are explicit',()=>{
 assert.equal(pricing.membershipItem('vip','monthly').unit_price_usd_cents,1999);
 assert.equal(pricing.membershipItem('elite','annual').unit_price_usd_cents,95990);
 assert.throws(()=>pricing.membershipItem('elite','weekly'));
 assert.equal(pricing.shipping(24999,null),1495);assert.equal(pricing.shipping(25000,null),0);
 assert.equal(pricing.shipping(1,{plan:'vip'}),0);
 assert.equal(pricing.earnings(999,null),24);assert.equal(pricing.earnings(999,{plan:'vip'}),49);assert.equal(pricing.earnings(999,{plan:'elite'}),99);
 assert.equal(pricing.earnings(-10,null),0);
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
