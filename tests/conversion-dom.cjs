// Isolated browser fixtures; requests never reach a provider or production database.
const {JSDOM}=require('jsdom'),fs=require('node:fs'),assert=require('node:assert/strict');
const config=require('../config/conversion.json');
const auth={auth:{getSession:async()=>({data:{session:{access_token:'fixture-only-token'}}})}};
const tick=()=>new Promise(r=>setTimeout(r,0));
(async()=>{
 const dom=new JSDOM('<main id="root"></main>',{url:'https://altapurelabs.test',runScripts:'outside-only'}),w=dom.window,root=w.document.querySelector('main'),calls=[];
 let joined=false;
 w.AltaConversionConfig=config;
 w.supabase={createClient:()=>auth};
 w.fetch=async(url,opts)=>{
  const body=opts?.body?JSON.parse(opts.body):null;calls.push({url,body,headers:opts?.headers});
  if(url==='/api/customer-config')return{ok:true,json:async()=>({supabaseUrl:'https://fixture.test',anonKey:'public-fixture'})};
  if(url.includes('checkout=cart'))return{ok:body.coupon!=='BAD',json:async()=>body.coupon==='BAD'?{error:'Unknown code'}:{subtotal_cents:10000,discount_cents:500,shipping_cents:0,total_cents:9500,free_shipping_remaining_cents:0,free_shipping_threshold_cents:25000,method_label:'Bank transfer',sign_in_for_benefits:false}};
  if(body?.action==='join'){joined=true;return{ok:true,json:async()=>({code:'AP-ABCDEFGH2345'})};}
  return{ok:true,json:async()=>({partner:joined?{code:'AP-ABCDEFGH2345',status:'active'}:null,events:[],summary:{earned_cents:0,eligible_cents:0,paid_cents:0},terms:config.partner})};
 };
 w.AltaStore={catalog:[{id:'bac-3',name:'BAC Water',variants:[{size:'3mL',price:6}]}],image:()=>'/fixture.png',product(){return this.catalog[0];},addItems(items){calls.push({added:items});}};
 w.eval(fs.readFileSync('conversion-ui.js','utf8'));
 await w.ConversionUI.cart(root,[{id:'fixture',size:'5mg',qty:1}]);
 assert.match(root.textContent,/Free US shipping unlocked/);assert.match(root.textContent,/\$95.00/);
 assert.equal(calls.find(c=>c.body?.items).headers.Authorization,'Bearer fixture-only-token');
 root.querySelector('[data-cv-add]').click();assert.equal(calls.at(-1).added[0].id,'bac-3');
 const f=root.querySelector('form');f.elements.coupon.value='BOGO';f.dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();await tick();assert.equal(w.sessionStorage.getItem('ap-cart-coupon'),'BOGO');
 f.elements.coupon.value='BAD';f.dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();await tick();assert.equal(w.sessionStorage.getItem('ap-cart-coupon'),'');assert.match(root.textContent,/Unknown code/);
 root.innerHTML='<div data-cv-memberships>'+w.ConversionUI.membershipCards(config)+'</div>';
 root.querySelector('[data-cv-period="annual"]').click();assert.match(root.textContent,/191.90/);assert.match(root.textContent,/959.90/);assert.equal(root.querySelector('[data-cv-period="annual"]').getAttribute('aria-selected'),'true');assert.ok(root.querySelector('a[href="/checkout?plan=vip&period=annual"]'));
 await w.ConversionUI.partner(root,auth);root.querySelector('input[type=checkbox]').checked=true;await root.querySelector('form').onsubmit({preventDefault(){},target:root.querySelector('form')});assert.equal(root.querySelector('input').value,'AP-ABCDEFGH2345');assert.match(root.textContent,/Referral activity/);assert.equal(calls.find(c=>c.body?.action==='join').body.terms_version,config.partner.version);
 dom.window.close();console.log('PASS: authenticated cart quote, add-on, coupon lifecycle, annual plan toggle and instant partner enrollment/dashboard.');
})().catch(e=>{console.error(e);process.exitCode=1;});
