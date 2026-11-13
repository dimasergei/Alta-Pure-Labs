const test=require('node:test'),assert=require('node:assert/strict');
const bank=require('../lib/partner-bank'),partner=require('../lib/partner-program'),delivery=require('../lib/delivery-options'),lotus=require('../lib/lotus-client');
const env={PARTNER_BANK_ENCRYPTION_KEY:'a'.repeat(64)},owner='00000000-0000-4000-8000-000000000001';
test('partner bank data validates account confirmation and routing checksum, encrypts and binds records to owner',()=>{
 const value=bank.normalize({holder:'Test fixture',bank_name:'Fixture bank',country:'US',account_type:'checking',routing_number:'021000021',account_number:'123456789',confirm_account:'123456789',authorized:true,phone:'5555550100',address:'123 Fixture Lane'});
 const encrypted=bank.encrypt(value,owner,env);assert.ok(!encrypted.includes('123456789'));assert.deepEqual(bank.decrypt(encrypted,owner,env),value);assert.throws(()=>bank.decrypt(encrypted,'another-owner',env));assert.throws(()=>bank.decrypt(encrypted.replace(/.$/,'A'),owner,{PARTNER_BANK_ENCRYPTION_KEY:'b'.repeat(64)}));assert.equal(bank.masked(value).last4,'6789');assert.equal(bank.masked(value).account_number,undefined);
 for(const change of [{routing_number:'021000022'},{confirm_account:'0000'},{country:'CA'},{authorized:false}])assert.throws(()=>bank.normalize({...value,confirm_account:value.account_number,authorized:true,...change}));
 assert.throws(()=>bank.encrypt(value,owner,{}));
});
test('custom referral codes normalize, reserve promotions and remain signed against tampering',()=>{
 assert.equal(partner.customCode(' My-Lab_20 '),'MY-LAB_20');assert.equal(partner.isReferralCode('BOGO'),false);assert.equal(partner.isReferralCode('MYLAB'),true);for(const code of ['BOGO','ADMIN','ab','has spaces','a'.repeat(25)])assert.throws(()=>partner.customCode(code));
 const now=1794410000000,value=partner.cookieToken('MY-LAB_20','fixture-key',now);assert.equal(partner.readCookie('ap_ref='+value,'fixture-key',now),'MY-LAB_20');assert.equal(partner.readCookie('ap_ref='+value.replace('MY-LAB','OTHER'),'fixture-key',now),null);
});
test('delivery extras are opt-in, disabled services are rejected, and only standard shipping is waived',()=>{
 assert.equal(delivery.price(undefined,false).total_cents,2500);assert.equal(delivery.price(undefined,true).total_cents,0);
 assert.throws(()=>delivery.price({shipping:'express',extras:[]},false),/unavailable/);assert.throws(()=>delivery.price({shipping:'standard',extras:['protection']},true),/unavailable/);assert.throws(()=>delivery.selection({shipping:'standard',extras:['priority','priority']}));
 const enabled=delivery.defaults.map(x=>({...x,enabled:true}));assert.equal(delivery.price({shipping:'express',extras:['priority','protection']},true,enabled).total_cents,4994);
});
test('Lotus client uses the fixed provider origin, exact decimal amounts and safe errors',async()=>{
 let calls=[];const api=lotus.client({env:{LOTUS_PARTNER_API_KEY:'ptr_test_'+'A'.repeat(43)},fetchImpl:async(u,o)=>{calls.push({u,o});return{ok:false,status:429,json:async()=>({error:{code:'rate_limited',message:'should not propagate keys or PII'}})};}});
 await assert.rejects(api.products(),e=>e.code==='rate_limited'&&e.retryable&&!e.message.includes('PII'));assert.match(calls[0].u,/^https:\/\/partners.lotuspeptide.com\/api\/v1\/products$/);assert.equal(calls[0].o.redirect,'error');assert.equal(lotus.cents('154.50'),15450);for(const x of ['1e2','1.999','NaN',3.14])assert.throws(()=>lotus.cents(x));
 assert.throws(()=>api.get('../other'),e=>e.code==='invalid_id');assert.equal(calls.length,1);
});
test('supplier worker cannot make a request while either activation gate is off',async()=>{
 const db={from(){const q={select(){return q},eq(){return q},single:async()=>({data:{enabled:false,max_order_cents:10000,verified_at:'2026-11-11'}})};return q;}};let called=false;
 const result=await require('../lib/lotus-fulfillment').run(db,{env:{LOTUS_FULFILLMENT_ENABLED:'true'},fetchImpl:async()=>{called=true}});assert.equal(result.enabled,false);assert.equal(called,false);
});
test('wallet availability requires a verified live native method and never exposes tokenization credentials',()=>{
 const checkout=require('../lib/direct-checkout');assert.deepEqual(checkout.capabilities([],{}),{card:false,card_method_id:null,apple_pay:false,google_pay:false});
 const m=[{id:'native-id',native_provider:'nmi'}];
 assert.equal(checkout.capabilities(m,{NMI_APPLE_PAY_ENABLED:'true'}).card,false);
 const config={NMI_API_KEY:'fixture-key',NMI_TOKENIZATION_KEY:'public-fixture-token',NMI_WEBHOOK_KEY:'fixture-webhook',
 NMI_MERCHANT_ID:'fixture-merchant',NMI_CURRENCIES:'USD',NMI_MODE:'live',NMI_ENABLED:'true',NMI_APPLE_PAY_ENABLED:'true',NMI_GOOGLE_PAY_ENABLED:'true'};
 const c=checkout.capabilities(m,config);assert.equal(c.apple_pay,true);assert.equal(c.google_pay,true);
 assert.equal(c.card_method_id,'native-id');assert.equal(c.tokenization_key,undefined);
 assert.equal(JSON.stringify(checkout.nmiPublicConfig(m,config)).includes('fixture-webhook'),false);
});
test('supplier operations reject unauthenticated and cross-origin writes before querying data',async()=>{
 const handler=require('../lib/lotus-admin').handle;let queried=false;
 const db={from(){queried=true;throw Error('must not query')}};
 const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v},status(n){this.code=n;return this},json(body){this.body=body;return this}});
 const env={ADMIN_ORDERS_PASSWORD:'s'.repeat(40),SITE_URL:'https://altapurelabs.com'};
 const r=response();await handler({method:'GET',headers:{}},r,new URLSearchParams(),{db,env});assert.equal(r.code,401);
 const s=response();await handler({method:'POST',headers:{'x-admin-password':env.ADMIN_ORDERS_PASSWORD,origin:'https://untrusted.test','content-type':'application/json'},body:{action:'run'}},s,new URLSearchParams(),{db,env});assert.equal(s.code,403);assert.equal(queried,false);
});
