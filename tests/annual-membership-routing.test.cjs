'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync('direct-checkout-client.js','utf8');
const {membershipItem}=require('../lib/conversion-pricing');
const customer={email:'researcher@example.test',user_metadata:{full_name:'Fixture Researcher',alta_profile:{}}};
const annualCents=membershipItem('vip','annual').unit_price_usd_cents;

function fixture(period){
 const url='https://altapurelabs.com/checkout?plan=vip'+(period===undefined?'':'&period='+encodeURIComponent(period));
 const dom=new JSDOM('<main id="root"></main>',{url,runScripts:'outside-only'}),w=dom.window,requests=[];
 w.HTMLElement.prototype.scrollIntoView=()=>{};
 Object.defineProperty(w.crypto,'randomUUID',{configurable:true,value:()=>'11111111-1111-4111-8111-111111111111'});
 Object.defineProperty(w.crypto,'subtle',{configurable:true,value:{digest:async()=>new Uint8Array(32).buffer}});
 w.AltaStore={cart:[]};
 w.ReadinessUI={enhanceCheckout(){},selection(){return{shipping:'standard',extras:[]}},delivery(){return'<p>No shipping</p>'}};
 const data={
  config:{version:'checkout-2026-11-v4',shipping_note:''},
  methods:[{id:'22222222-2222-4222-8222-222222222222',kind:'bank_transfer',sale_scope:'membership',label:'Bank transfer'}],
  terms:{memberships:{vip:{name:'Alta VIP',discount_bps:500,price_cents:4900}},
   conversion:{plans:{vip:{annual_cents:annualCents,monthly_cents:1999}}}},
  membership:null,balances:{points:0,credit_cents:0},nmi:null
 };
 w.fetch=async(_url,options={})=>{
  if(!options.body)return{ok:true,json:async()=>data};
  const body=JSON.parse(options.body);requests.push(body);
  if(body.action!=='quote')throw Error('Isolated fixture never places an order');
  return{ok:true,json:async()=>({
   subtotal_cents:annualCents,discount_cents:0,shipping_cents:0,tax_cents:0,
   points_redeemed:0,credit_redeemed_cents:0,total_cents:annualCents,
   earned_points:0,currency:'USD',quote:'fixture-only-not-a-signature',pricing:{billing_period:'annual'}
  })};
 };
 const auth={auth:{getSession:async()=>({data:{session:{access_token:'isolated-test-token'}}})}};
 w.eval(source);
 return{dom,w,root:w.document.getElementById('root'),auth,requests};
}
async function quoteAnnual(period){
 const f=fixture(period);
 try{
  await f.w.DirectCheckout.checkout(f.root,f.auth,customer);
  const section=f.root.querySelector('aside.dc-summary');
  assert.ok(section,'Membership summary must be shown');
  assert.match(section.textContent,/\$191\.90/, 'Annual membership summary must use annual backend price, not the obsolete fixed-price term');
  assert.match(section.textContent,/Annual membership/i);
  f.root.querySelector('[data-step-next="0"]').click();
  f.root.querySelector('[data-step-next="1"]').click();
  const consent=f.root.querySelector('[name=consent]');
  assert.ok(consent);
  consent.checked=true;
  f.root.querySelector('form').dispatchEvent(new f.w.Event('submit',{bubbles:true,cancelable:true}));
  await new Promise(resolve=>setTimeout(resolve,90));
  assert.equal(f.requests.length,1,'Quote once and do not place/pay in the fixture');
  assert.equal(f.requests[0].kind,'membership');
  assert.equal(f.requests[0].plan,'vip');
  assert.equal(f.requests[0].billing_period,'annual','The backend must not silently use its monthly default');
  assert.equal(f.root.querySelector('.dc-review-summary .dc-due')?.textContent?.includes('$191.90'),true);
 }finally{f.dom.window.close();}
}
test('explicit annual membership URL quotes annual period and matching price, not monthly',async()=>quoteAnnual('annual'));
test('legacy membership URL with no period defaults explicitly to annual',async()=>quoteAnnual(undefined));
test('unsupported monthly URL stops before any quote, order or payment request',async()=>{
 const f=fixture('monthly');
 try{
  await f.w.DirectCheckout.checkout(f.root,f.auth,customer);
  assert.match(f.root.textContent,/Monthly membership checkout is not offered/);
  assert.equal(f.root.querySelector('form'),null);
  assert.equal(f.requests.length,0);
 }finally{f.dom.window.close();}
});
