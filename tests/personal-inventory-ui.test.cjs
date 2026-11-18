const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const html=fs.readFileSync(path.join(__dirname,'../admin-inventory.html'),'utf8');
const script=fs.readFileSync(path.join(__dirname,'../admin-inventory.js'),'utf8');
const clone=value=>JSON.parse(JSON.stringify(value));
const item=(overrides={})=>({id:'11111111-1111-4111-8111-111111111111',sku:'BPC-10-V',product_name:'BPC-157',strength:'10 mg',unit:'vial',quantity:null,minimum:5,unit_cost:null,currency:'USD',location:'',notes:'',archived:false,version:1,created_at:'2026-11-17T18:00:00Z',updated_at:'2026-11-17T18:00:00Z',...overrides});
async function settle(check){for(let i=0;i<100;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,5));}assert.fail('UI did not reach the expected state');}
function mount(initial=[]){
 const dom=new JSDOM(html,{url:'https://example.test/admin-inventory.html',runScripts:'outside-only'}),w=dom.window,$=id=>w.document.getElementById(id);
 const state={items:clone(initial),posts:[],failNext:false,serverFailure:false,events:[],downloads:[],replays:new Map()};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.HTMLAnchorElement.prototype.click=function(){state.downloads.push({name:this.download,blob:state.lastBlob});};
 w.Blob=class{constructor(parts){this.parts=parts;}};w.URL.createObjectURL=blob=>{state.lastBlob=blob;return 'blob:test';};w.URL.revokeObjectURL=()=>{};
 const response=(status,payload)=>({ok:status>=200&&status<300,status,json:async()=>clone(payload)});
 w.PureAdminAuth={authenticated:true,bindForm({onAuthenticated}){Promise.resolve().then(onAuthenticated);},async logout(){this.authenticated=false;w.dispatchEvent(new w.CustomEvent('pure-admin-auth-change',{detail:{authenticated:false}}));},async fetch(url,options={}){
   assert.match(String(url),/^\/api\/customer-config\?inventory=1(?:&|$)/);
   if(options.method!=='POST')return response(200,String(url).includes('view=activity')?{events:state.events,has_more:false}:{items:state.items});
   const body=JSON.parse(options.body);state.posts.push(body);assert.match(body.request_id,/^[0-9a-f-]{36}$/);
   if(state.failNext){state.failNext=false;throw new Error('offline');}
   if(state.serverFailure){state.serverFailure=false;return response(503,{error:'Please retry.'});}
   if(state.replays.has(body.request_id))return response(200,state.replays.get(body.request_id));
   const current=state.items.find(entry=>entry.id===body.id);
   if(current&&body.expected_version!==current.version)return response(409,{error:'Version conflict',code:'VERSION_CONFLICT'});
   let payload;
   if(body.action==='create'){
     if(state.items.some(entry=>entry.sku===body.item.sku))return response(409,{error:'That SKU already exists.',code:'DUPLICATE_SKU'});
     const saved=item({...body.item,id:'new-'+state.items.length});state.items.push(saved);payload={item:saved};
   }else if(body.action==='update'){assert.equal(Object.hasOwn(body.item,'quantity'),false);Object.assign(current,body.item,{version:current.version+1});payload={item:current};
   }else if(body.action==='adjust'){current.quantity=body.mode==='set'?body.quantity:body.mode==='add'?current.quantity+body.quantity:current.quantity-body.quantity;current.version++;payload={item:current};
   }else if(body.action==='archive'){current.archived=body.archived;current.version++;payload={item:current};
   }else if(body.action==='preview_import'){const codes=new Set(state.items.map(entry=>entry.sku));for(const entry of body.items){if(codes.has(entry.sku))return response(409,{error:'Duplicate SKU '+entry.sku,code:'DUPLICATE_SKU'});codes.add(entry.sku);}payload={items:body.items,count:body.items.length};
   }else if(body.action==='import'){const created=body.items.map((entry,index)=>item({...entry,id:'import-'+index}));state.items.push(...created);payload={items:created};
   }else throw new Error('Unexpected action '+body.action);
   if(body.action!=='preview_import')state.replays.set(body.request_id,clone(payload));return response(200,payload);
 }};
 w.eval(script);
 const input=(id,value)=>{$(id).value=String(value);$(id).dispatchEvent(new w.Event(id.includes('filter')||id==='iv-unit'?'change':'input',{bubbles:true}));};
 const submit=id=>$(id).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 return {dom,w,$,state,input,submit,ready:()=>settle(()=>!$('iv-add').disabled)};
}

test('manual stock distinguishes unknown, zero, low and archived; unknown can only be counted',async()=>{
 const app=mount([item(),item({id:'zero',sku:'ZERO',quantity:0}),item({id:'low',sku:'LOW',quantity:3}),item({id:'archived',sku:'OLD',quantity:0,archived:true})]);
 try{await app.ready();assert.equal(app.$('iv-stat-total').textContent,'3');assert.equal(app.$('iv-stat-low').textContent,'1');assert.equal(app.$('iv-stat-out').textContent,'1');assert.equal(app.$('iv-stat-unknown').textContent,'1');
 const row=app.w.document.querySelector('[data-item-id="11111111-1111-4111-8111-111111111111"]');assert.ok(row.querySelector('.iv-adjust-shortcut').disabled);row.querySelector('.iv-quantity').click();assert.equal(app.$('iv-adjust-mode').value,'set');assert.ok(app.$('iv-adjust-mode').options[1].disabled);
 app.input('iv-adjust-quantity','0');app.input('iv-adjust-reason','Counted empty');app.submit('iv-adjust-form');await settle(()=>!app.$('iv-adjuster').open);assert.equal(app.state.posts.at(-1).quantity,0);assert.equal(app.$('iv-stat-out').textContent,'2');assert.equal(app.$('iv-stat-unknown').textContent,'0');
 }finally{app.dom.window.close();}
});

test('add item suggests SKU, preserves custom code, and saves unknown quantity explicitly',async()=>{
 const app=mount();try{await app.ready();assert.match(app.$('iv-items').textContent,/Your stock list starts here/);app.$('iv-add').click();app.input('iv-name','Test product');app.input('iv-strength','10 mg');assert.equal(app.$('iv-sku').value,'TEST-PRODUCT-10-MG-V');app.input('iv-sku','MY-ITEM');app.input('iv-strength','20 mg');assert.equal(app.$('iv-sku').value,'MY-ITEM');app.submit('iv-item-form');await settle(()=>!app.$('iv-editor').open);const saved=app.state.posts.at(-1);assert.equal(saved.action,'create');assert.equal(saved.item.quantity,null);assert.equal(saved.item.sku,'MY-ITEM');assert.equal(app.$('iv-stat-unknown').textContent,'1');}finally{app.dom.window.close();}
});

test('a failed save retries the same request ID and keeps the entry',async()=>{
 const app=mount([item({quantity:10})]);try{await app.ready();app.w.document.querySelector('.iv-adjust-shortcut').click();app.input('iv-adjust-quantity','4');app.input('iv-adjust-reason','New box');app.state.failNext=true;app.submit('iv-adjust-form');await settle(()=>app.$('iv-adjust-form').dataset.busy==='false');assert.equal(app.$('iv-adjust-quantity').value,'4');assert.match(app.$('iv-adjust-error').textContent,/Try again/);const first=app.state.posts.at(-1);app.submit('iv-adjust-form');await settle(()=>!app.$('iv-adjuster').open);const second=app.state.posts.at(-1);assert.equal(second.request_id,first.request_id);assert.equal(app.state.items[0].quantity,14);}finally{app.dom.window.close();}
});

test('stale metadata reload retains edits and preserves concurrently changed untouched fields',async()=>{
 const app=mount([item({quantity:10})]);try{await app.ready();app.w.document.querySelector('.iv-product-name').click();app.input('iv-location','Shelf B');app.state.items[0].product_name='Renamed elsewhere';app.state.items[0].quantity=8;app.state.items[0].version=2;app.submit('iv-item-form');await settle(()=>!app.$('iv-editor-reload').hidden);assert.equal(app.$('iv-location').value,'Shelf B');app.$('iv-editor-reload').click();await settle(()=>app.$('iv-editor-reload').hidden);assert.equal(app.$('iv-location').value,'Shelf B');assert.equal(app.$('iv-name').value,'Renamed elsewhere');app.submit('iv-item-form');await settle(()=>!app.$('iv-editor').open);const saved=app.state.posts.at(-1);assert.equal(saved.expected_version,2);assert.deepEqual(saved.item,{location:'Shelf B'});assert.equal(app.state.items[0].quantity,8);}finally{app.dom.window.close();}
});

test('archive leaves quantity intact and archived view can restore it',async()=>{
 const app=mount([item({quantity:12})]);try{await app.ready();app.w.document.querySelector('.iv-archive-action').click();await settle(()=>app.$('iv-stat-total').textContent==='0');assert.equal(app.state.items[0].quantity,12);app.input('iv-filter-status','archived');assert.match(app.$('iv-items').textContent,/Restore/);app.w.document.querySelector('.iv-archive-action').click();await settle(()=>app.$('iv-stat-total').textContent==='1');assert.equal(app.state.items[0].quantity,12);}finally{app.dom.window.close();}
});

test('CSV import previews without saving, parses quoted notes and unknown counts, then creates rows',async()=>{
 const app=mount();try{await app.ready();app.$('iv-import').click();const text='sku,product_name,strength,quantity,unit,minimum,notes\r\nONE,"One, item",10mg,,vial,2,"line 1\nline 2"\r\nTWO,Second,20mg,0,pen,0,Empty\r\n';Object.defineProperty(app.$('iv-csv-file'),'files',{configurable:true,value:[{size:text.length,text:async()=>text}]});app.submit('iv-import-form');await settle(()=>!app.$('iv-import-save').hidden);assert.equal(app.state.items.length,0);assert.equal(app.state.posts.at(-1).action,'preview_import');assert.equal(app.state.posts.at(-1).items[0].quantity,null);assert.equal(app.state.posts.at(-1).items[1].quantity,0);assert.equal(app.state.posts.at(-1).items[0].notes,'line 1\nline 2');app.$('iv-import-save').click();await settle(()=>!app.$('iv-importer').open);assert.equal(app.state.items.length,2);assert.equal(app.$('iv-stat-unknown').textContent,'1');assert.equal(app.$('iv-stat-out').textContent,'1');}finally{app.dom.window.close();}
});

test('CSV export neutralizes formulas and exports only the current filtered view',async()=>{
 const app=mount([item({product_name:'=SUM(1,2)',notes:' @cmd',quantity:0}),item({id:'other',sku:'OTHER',product_name:'Other',quantity:1})]);try{await app.ready();app.input('iv-search','SUM');app.$('iv-export').click();assert.equal(app.state.downloads.length,1);const text=app.state.downloads[0].blob.parts.join('');assert.match(text,/"'=SUM\(1,2\)"/);assert.match(text,/"' @cmd"/);assert.doesNotMatch(text,/OTHER/);assert.match(text,/"0"/);}finally{app.dom.window.close();}
});

test('logout clears stock details from tables, editor fields, count text, metrics and search',async()=>{
 const app=mount([item({quantity:73,notes:'Private storage note',unit_cost:9.5})]);try{await app.ready();app.input('iv-search','BPC');app.w.document.querySelector('.iv-product-name').click();assert.equal(app.$('iv-notes').value,'Private storage note');app.$('iv-logout').click();await settle(()=>!app.$('iv-login').hidden && app.$('iv-login-error').textContent==='Logged out.');assert.equal(app.$('iv-name').value,'');assert.equal(app.$('iv-notes').value,'');assert.equal(app.$('iv-cost').value,'');assert.equal(app.$('iv-items').textContent,'');assert.equal(app.$('iv-stat-total').textContent,'—');assert.equal(app.$('iv-search').value,'');assert.ok(!app.$('iv-editor').open);assert.ok(app.$('iv-export').disabled);}finally{app.dom.window.close();}
});

test('CSV rejects hexadecimal cost before requesting a server preview',async()=>{
 const app=mount();try{await app.ready();app.$('iv-import').click();const text='sku,product_name,unit_cost\nHEX,Test,0x10\n';Object.defineProperty(app.$('iv-csv-file'),'files',{value:[{size:text.length,text:async()=>text}]});app.submit('iv-import-form');await settle(()=>app.$('iv-import-form').dataset.busy==='false');assert.match(app.$('iv-import-error').textContent,/decimal amount/);assert.equal(app.state.posts.length,0);}finally{app.dom.window.close();}
});

test('CSV preview allows inspection of every row beyond the first screen',async()=>{
 const app=mount();try{await app.ready();app.$('iv-import').click();const text='sku,product_name\n'+Array.from({length:40},(_,i)=>'SKU-'+i+',Item '+i).join('\n');Object.defineProperty(app.$('iv-csv-file'),'files',{value:[{size:text.length,text:async()=>text}]});app.submit('iv-import-form');await settle(()=>!app.$('iv-import-save').hidden);assert.equal(app.$('iv-import-rows').children.length,40);assert.match(app.$('iv-import-rows').textContent,/SKU-39/);assert.equal(app.state.items.length,0);}finally{app.dom.window.close();}
});

test('server uncertainty retains retry identity and labels the save as unconfirmed',async()=>{
 const app=mount([item({quantity:10})]);try{await app.ready();app.w.document.querySelector('.iv-adjust-shortcut').click();app.input('iv-adjust-quantity','2');app.input('iv-adjust-reason','Stock added');app.state.serverFailure=true;app.submit('iv-adjust-form');await settle(()=>app.$('iv-adjust-form').dataset.busy==='false');assert.equal(app.$('iv-save-text').textContent,'Save not confirmed');const previous=app.state.posts.at(-1).request_id;app.submit('iv-adjust-form');await settle(()=>!app.$('iv-adjuster').open);assert.equal(app.state.posts.at(-1).request_id,previous);app.input('iv-search','no-match');assert.ok(app.$('iv-export').disabled);app.$('iv-refresh').click();await settle(()=>app.$('iv-save-text').textContent==='Up to date');assert.ok(app.$('iv-export').disabled);}finally{app.dom.window.close();}
});
