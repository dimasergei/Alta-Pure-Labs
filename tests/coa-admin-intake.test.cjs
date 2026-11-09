'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {normalizeReport,intakeReport}=require('../lib/coa-admin-intake');
const root=path.resolve(__dirname,'..');
const lot='10000000-0000-4000-8000-000000000001';
const sample={lot_id:lot,report_id:'SUPPLIER-COA-123',lab_name:'Source-stated laboratory',source_url:'https://supplier.example/reports/123.pdf'};
test('valid supplier references are always pending and unpublished',()=>{
 const normalized=normalizeReport(sample);
 assert.equal(normalized.status,'pending');
 assert.equal(normalized.publication_approved,false);
 assert.equal(normalized.reviewed_at,null);
 assert.match(normalized.storage_object_key,/^external-reference\/[a-f0-9]{64}$/);
});
test('invalid, private and insecure URLs cannot enter intake',()=>{
 for(const url of ['http://supplier.example/a.pdf','https://localhost/a.pdf',
  'https://127.0.0.1/a.pdf','https://user:password@supplier.example/a.pdf',
  'https://supplier.example:8443/a.pdf','file:///tmp/a.pdf']){
  assert.equal(normalizeReport({...sample,source_url:url}),null,url);
 }
});
test('missing lot and demo lot are rejected without writing',async()=>{
 let writes=0;
 const db={from(table){
  if(table==='enterprise_inventory_lots')return{select(){return{eq(){return{maybeSingle:async()=>({data:null,error:null})};}};}};
  if(table==='enterprise_quality_documents'){writes++;throw Error('unexpected write');}
  throw Error('unknown table');
 }};
 const result=await intakeReport(db,sample);
 assert.equal(result.ok,false);assert.equal(result.reason,'LOT_NOT_FOUND');assert.equal(writes,0);
});
test('intake cannot mark supplier document verified or approved',async()=>{
 const writes=[];
 const db={from(table){
  if(table==='enterprise_inventory_lots')return{select(){return{eq(){return{maybeSingle:async()=>({data:{id:lot,lot_number:'REAL-LOT-123'},error:null})};}};}};
  if(table==='enterprise_quality_documents')return{insert(value){writes.push(value);return{select(){return{single:async()=>({data:{id:'doc-1',status:'pending',publication_approved:false},error:null})};}};}};
  throw Error('unknown table');
 }};
 const result=await intakeReport(db,{...sample,status:'verified',publication_approved:true,reviewer:'attacker'});
 assert.equal(result.ok,true);assert.equal(result.verified,false);
 assert.equal(writes[0].status,'pending');assert.equal(writes[0].publication_approved,false);
 assert.equal(writes[0].reviewer,null);
});
test('public verified registry remains separate from pending intake',()=>{
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'data/verified-coas.json'),'utf8')),[]);
 const html=fs.readFileSync(path.join(root,'admin-inventory.html'),'utf8');
 assert.match(html,/pending, unpublished reference only/);
 assert.match(html,/id="coa-intake-form"/);
});
