'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
async function checkout(wallets){
 const elements={},requests=[];let mounted;
 const element=id=>elements[id]||(elements[id]={hidden:false,textContent:'',checked:true,value:'',append(){},replaceChildren(){},reportValidity(){return true;}});
 const fields=Object.fromEntries(['country','first_name','last_name','address1','city','state','zip'].map(name=>[name,element(name)]));
 element('native-billing').elements=fields;fields.country.value='US';
 const invoice={id:'80000000-0000-4000-8000-000000000002',status:'accepted',amount_cents:12345,currency:'USD',expires_at:'2099-01-01'};
 const data={invoice,attempts:[],gateway:{provider:'nmi',ready:true,mode:'sandbox',countries:['US'],wallets,tokenization_key:'fixture-public',three_ds:false},customer:{name:'Test Researcher',email:'test@example.test',address:{country:'US'}}};
 const context={document:{getElementById:element,createElement:()=>({})},location:{search:'?invoice='+invoice.id},URLSearchParams,Intl,Date,crypto:{randomUUID:()=> '80000000-0000-4000-8000-000000000003'},FormData:class{constructor(){return Object.entries({first_name:'Test',last_name:'Researcher',country:'US'})}},clearInterval(){},setInterval(){},setTimeout,clearTimeout};
 context.window={supabase:{createClient:()=>({auth:{getSession:async()=>({data:{session:{access_token:'fixture-access'}}})}})},mountNmiPayments:(selector,options)=>{mounted=options;return{destroy(){}};}};
 context.fetch=async(url,options)=>{if(url==='/api/customer-config')return{ok:true,json:async()=>({supabaseUrl:'fixture',anonKey:'fixture'})};if(options.method==='POST'){requests.push(JSON.parse(options.body));return{ok:true,json:async()=>({state:'paid'})};}return{ok:true,json:async()=>data};};
 vm.runInNewContext(fs.readFileSync('native-pay.js','utf8'),context);
 await new Promise(resolve=>setImmediate(resolve));assert.ok(mounted,'component mounted');
 return{mounted,requests,invoice,elements};
}
test('wallet flags select the exact identifiers supported by the pinned NMI SDK',async()=>{
 for(const [wallets,expected]of [[{apple:false,google:false},['card']],[{apple:true,google:false},['card','apple-pay']],[{apple:false,google:true},['card','google-pay']],[{apple:true,google:true},['card','google-pay','apple-pay']]]){
  const {mounted}=await checkout(wallets);assert.deepEqual(Array.from(mounted.paymentMethods),expected);
 }
});
test('express wallet callback uses the accepted invoice amount and the protected payment path once',async()=>{
 const {mounted,requests,invoice,elements}=await checkout({apple:true,google:true});
 assert.equal(mounted.expressCheckoutConfig.amount,'123.45');assert.equal(mounted.expressCheckoutConfig.currency,'USD');
 await Promise.all([mounted.onExpressCheckout({token:'fixture-wallet-token'}),mounted.onExpressCheckout({token:'fixture-wallet-token'})]);
 assert.equal(requests.length,1);assert.equal(requests[0].payment_token,'fixture-wallet-token');assert.equal(requests[0].invoice_id,invoice.id);assert.equal(requests[0].confirm_amount_cents,12345);assert.equal(requests[0].confirm_currency,'USD');assert.equal(requests[0].consent,true);assert.equal(elements['native-form'].hidden,true);
});

async function paymentPage(search,respond){
 const dom=new JSDOM(fs.readFileSync('pay.html','utf8'),{url:'https://getpurelabs.com/pay.html'+search,runScripts:'outside-only'}),w=dom.window,requests=[];
 const refresh=w.document.getElementById('native-refresh');
 assert.equal(refresh.hidden,true,'Refresh is hidden before JavaScript initializes');
 assert.equal(refresh.disabled,true,'Refresh cannot be clicked before initialization');
 w.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{access_token:'fixture-access'}}})}})};
 w.fetch=async(url,options)=>{requests.push({url,method:options?.method||'GET'});return respond(url,options);};
 w.eval(fs.readFileSync('native-pay.js','utf8'));
 await new Promise(resolve=>setImmediate(resolve));
 return{dom,w,refresh,requests,status:w.document.getElementById('native-status')};
}

test('missing or malformed payment references preserve their explanation without an active refresh',async t=>{
 for(const search of ['', '?invoice=invalid']){
  const {dom,refresh,requests,status}=await paymentPage(search,()=>{throw Error('Unexpected request');});t.after(()=>dom.window.close());
  assert.equal(dom.window.document.getElementById('native-title').textContent,'Payment unavailable');
  assert.match(status.textContent,/Open the secure payment link/);const explanation=status.textContent;
  assert.equal(refresh.hidden,true);assert.equal(refresh.disabled,true);
  refresh.click();await refresh.onclick();
  assert.equal(status.textContent,explanation);assert.equal(requests.length,0);
 }
});

test('configuration or ownership errors keep payment refresh inactive',async t=>{
 for(const failure of ['config','ownership']){
  const {dom,refresh,requests,status}=await paymentPage('?invoice=80000000-0000-4000-8000-000000000002',async url=>{
   if(url==='/api/customer-config')return{ok:failure!=='config',json:async()=>({supabaseUrl:'fixture',anonKey:'fixture'})};
   return{ok:false,json:async()=>({error:'Order not found or access denied.'})};
  });t.after(()=>dom.window.close());
  assert.equal(refresh.hidden,true);assert.equal(refresh.disabled,true);
  assert.equal(status.textContent,failure==='config'?'Account configuration unavailable.':'Order not found or access denied.');
  const explanation=status.textContent,count=requests.length;
  refresh.click();await refresh.onclick();
  assert.equal(status.textContent,explanation);assert.equal(requests.length,count);
 }
});

test('an authorized order enables refresh without initiating a payment',async t=>{
 const fixtureId='80000000-0000-4000-8000-000000000002';
 const {dom,refresh,requests}=await paymentPage('?invoice='+fixtureId,async url=>url==='/api/customer-config'
  ?{ok:true,json:async()=>({supabaseUrl:'fixture',anonKey:'fixture'})}
  :{ok:true,json:async()=>({invoice:{id:fixtureId,status:'paid',amount_cents:12345,currency:'USD'},gateway:{}})});
 t.after(()=>dom.window.close());
 assert.equal(dom.window.document.getElementById('native-title').textContent,'Payment confirmed');
 assert.equal(refresh.hidden,false);assert.equal(refresh.disabled,false);
 const before=requests.length;refresh.click();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(requests.length,before+1);assert.ok(requests.every(r=>r.method==='GET'));
});
