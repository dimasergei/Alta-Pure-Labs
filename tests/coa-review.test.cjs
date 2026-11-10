'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {changeReportStatus}=require('../lib/coa-review');
const id='10000000-0000-4000-8000-000000000001';
function mockDb({status='withdrawn',error=null}={}){
 const calls=[];
 return {calls,db:{async rpc(name,args){
  calls.push({name,args});
  return {data:error?null:{id,status,publication_approved:false},error};
 }}};
}
test('withdrawal calls the atomic audited RPC with a reason',async()=>{
 const x=mockDb();
 const r=await changeReportStatus(x.db,{report_id:id,action:'withdraw',reason:'Supplier revoked the published report'});
 assert.equal(r.ok,true);assert.equal(r.audit_recorded,true);
 assert.equal(r.report.publication_approved,false);
 assert.equal(x.calls[0].name,'enterprise_review_quality_document');
 assert.equal(x.calls[0].args.p_reason,'Supplier revoked the published report');
});
test('rejection uses the same atomic RPC and never grants publication',async()=>{
 const x=mockDb({status:'rejected'});
 const r=await changeReportStatus(x.db,{report_id:id,action:'reject',reason:'Identity verification was unsuccessful'});
 assert.equal(r.report.status,'rejected');assert.equal(r.publicly_verified,false);
});
test('invalid review requests cannot invoke the database',async()=>{
 const x=mockDb();
 for(const action of ['approve','verify','publish']){
  const r=await changeReportStatus(x.db,{report_id:id,action,reason:'No independent review was performed'});
  assert.equal(r.ok,false);
 }
 assert.equal(x.calls.length,0);
});
test('database rejects illegal transitions without reporting success',async()=>{
 const x=mockDb({error:{code:'P0001'}});
 const r=await changeReportStatus(x.db,{report_id:id,action:'reject',reason:'Previously verified report cannot be rejected'});
 assert.equal(r.ok,false);assert.equal(r.reason,'REVIEW_TRANSITION_DENIED');
});
test('admin UI exposes withdrawal and rejection but no self-verification button',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../admin-inventory.html'),'utf8');
 assert.match(html,/coa-review-form/);assert.match(html,/Withdraw report/);
 assert.doesNotMatch(html,/Approve as verified/);
});
