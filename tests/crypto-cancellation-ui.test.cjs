'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
const source=fs.readFileSync(require.resolve('../direct-checkout-client.js'),'utf8');
async function setup(cancellation=null){
 const dom=new JSDOM('<main></main>',{url:'https://getpurelabs.com/account/purchases',runScripts:'outside-only'}),w=dom.window,calls=[];
 const order={id:'10000000-0000-4000-8000-000000000001',status:'accepted',checkout_version:'checkout-2026-11-v6',currency:'USD',total_cents:950,created_at:'2026-11-17T22:00:00Z',payable:true,payment_snapshot:{payment_url:'/pay.html?invoice=fixture'},cancellation_status:cancellation};
 w.confirm=()=>true;w.fetch=async(url,options)=>{const body=options.body&&JSON.parse(options.body);calls.push(body||{get:url});if(body){order.cancellation_status='pending';return{ok:true,json:async()=>({status:'accepted',cancellation_status:'pending'})};}return{ok:true,json:async()=>({invoices:[order]})};};
 w.eval(source);const root=w.document.querySelector('main'),auth={auth:{getSession:async()=>({data:{session:{access_token:'fixture-token'}}})}};
 await w.DirectCheckout.orders(root,auth,{id:'fixture'});return{dom,w,root,calls,close:()=>w.close()};
}
test('customer accepts cancellation pending and replaces payment links with its hold notice',async()=>{const d=await setup();try{
 assert.ok([...d.root.querySelectorAll('a')].some(x=>x.textContent==='Pay securely'));
 await [...d.root.querySelectorAll('button')].find(x=>x.textContent==='Cancel order').onclick();
 assert.match(d.root.textContent,/Cancellation pending/);assert.match(d.root.textContent,/Do not send payment/);assert.doesNotMatch(d.root.textContent,/Cancellation not confirmed/);
 assert.equal(d.root.querySelectorAll('a').length,0);assert.ok([...d.root.querySelectorAll('button')].some(x=>x.textContent==='Check cancellation'));
 assert.equal(d.calls.filter(x=>x.action==='cancel').length,1);
}finally{d.close();}});
test('customer review state holds the order and directs payment reconciliation to support',async()=>{const d=await setup('review');try{
 assert.match(d.root.textContent,/Cancellation needs payment review/);assert.match(d.root.textContent,/support@getpurelabs.com/);
 assert.equal(d.root.querySelectorAll('a,button').length,0);
}finally{d.close();}});
