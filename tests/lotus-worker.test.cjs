const test=require('node:test'),assert=require('node:assert/strict'),{run}=require('../lib/lotus-fulfillment');
const id='00000000-0000-4000-8000-000000000001',env={LOTUS_FULFILLMENT_ENABLED:'true',LOTUS_PARTNER_API_KEY:'ptr_live_'+'A'.repeat(43)};
function fixture({status='paid',payload=null,supplier_id=null}={}){const saved=[],rpc=[],job={invoice_id:id,reference:'ALTA-'+id,attempts:1,payload,supplier_id},order={id,kind:'goods',status,version:2,customer_name:'Fixture',customer_email:'fixture@example.test',request_data:{items:[{id:'fixture',size:'5mg',qty:2}],address:{country:'US',line1:'123 Fixture St',city:'Miami',region:'FL',postal_code:'33101'}}};const values={commerce_supplier_settings:{enabled:true,verified_at:'2026-11-11',max_order_cents:20000},commerce_invoices:order,commerce_supplier_mappings:[{variant_key:'fixture|5mg',product:12,vials:2}]};return{saved,rpc,job,db:{from(t){const q={select(){return q},eq(){return q},single(){return q},then(resolve){return Promise.resolve({data:values[t]}).then(resolve)}};return q;},async rpc(name,args){rpc.push({name,args});if(name==='commerce_supplier_claim')return{data:[job]};if(name==='commerce_supplier_save')saved.push(args.p_data);return{data:{}};}}};}
const reply=data=>({ok:true,status:200,json:async()=>data});
test('supplier submission persists the immutable reference/payload before POST and never treats a label as dispatch',async()=>{
 const f=fixture(),requests=[];const result=await run(f.db,{env,fetchImpl:async(url,opts)=>{requests.push({url,body:opts.body&&JSON.parse(opts.body)});if(url.endsWith('/quote'))return reply({owed_total:'100.00',lines:[{problem:null}],problems:[]});assert.ok(f.saved[0].payload);return reply({id:'opaque1',reference:'ALTA-'+id,mode:'live',status:'paid',settlement:'owed',owed_total:'100.00',tracking_number:'LABELONLY',carrier:'UPS'});}});
 assert.equal(result.status,'submitted');assert.equal(requests[1].body.reference,'ALTA-'+id);assert.equal(f.saved.at(-1).supplier_id,'opaque1');assert.equal(f.rpc.filter(x=>x.name==='commerce_admin_command').length,0);
});
test('ambiguous create is reconciled by the same reference and does not create again',async()=>{
 const f=fixture({payload:{reference:'ALTA-'+id,expected_owed:'100.00'}}),requests=[];
 await run(f.db,{env,fetchImpl:async(url,opts)=>{requests.push(opts.method);return reply({id:'opaque1',reference:'ALTA-'+id,mode:'live',status:'paid',settlement:'owed',owed_total:'100.00'});}});assert.deepEqual(requests,['GET']);assert.equal(f.saved.at(-1).supplier_id,'opaque1');
});
test('full refund cancels a recovered supplier order and prevents a new submission',async()=>{
 const f=fixture({status:'refunded',payload:{reference:'ALTA-'+id,expected_owed:'100.00'}}),requests=[];
 await run(f.db,{env,fetchImpl:async(url,opts)=>{requests.push({url,method:opts.method});return reply({id:'opaque1',reference:'ALTA-'+id,mode:'live',status:opts.method==='POST'?'cancelled':'paid'});}});assert.equal(requests[1].url.endsWith('/opaque1/cancel'),true);assert.equal(f.saved.at(-1).status,'cancelled');
});
test('unavailable inventory, changed pricing and reference conflicts stop for review; transport errors retry',async()=>{
 for(const [status,code,expected]of [[422,'invalid_request','blocked'],[409,'price_changed','blocked'],[409,'reference_conflict','blocked'],[429,'rate_limited','retry'],[500,'internal_error','retry']]){const f=fixture({payload:{reference:'ALTA-'+id,expected_owed:'100.00'},supplier_id:'opaque1'});await run(f.db,{env,fetchImpl:async()=>({ok:false,status,json:async()=>({error:{code}})})});assert.equal(f.saved.at(-1).status,expected);assert.equal(f.saved.at(-1).last_error,code);}
});
test('confirmed shipment uses existing audited order transition; mode mismatch does not affect a customer order',async()=>{
 const f=fixture({supplier_id:'opaque1'});await run(f.db,{env,fetchImpl:async()=>reply({id:'opaque1',reference:'ALTA-'+id,mode:'live',status:'shipped',settlement:'settled',tracking_number:'TRACK123',carrier:'UPS',shipped_at:'2026-11-11T18:00:00Z'})});assert.equal(f.rpc.find(x=>x.name==='commerce_admin_command').args.p_data.status,'shipped');assert.equal(f.saved.at(-1).status,'shipped');
 const g=fixture({supplier_id:'opaque1'});await run(g.db,{env,fetchImpl:async()=>reply({id:'opaque1',reference:'ALTA-'+id,mode:'test',status:'shipped'})});assert.equal(g.saved.at(-1).status,'blocked');assert.equal(g.rpc.some(x=>x.name==='commerce_admin_command'),false);
});
