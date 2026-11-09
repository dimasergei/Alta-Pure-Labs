'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {changeReportStatus}=require('../lib/coa-review');
const id='10000000-0000-4000-8000-000000000001';
function dbWith(status){
 const writes=[];
 return {writes,db:{from(table){
  assert.equal(table,'enterprise_quality_documents');
  return {
   select(){return{eq(){return{maybeSingle:async()=>({data:{id,status,publication_approved:status==='verified'},error:null})};}};},
   update(payload){writes.push(payload);return{eq(){return{eq(){return{select(){return{maybeSingle:async()=>({data:{id,status:payload.status,publication_approved:payload.publication_approved},error:null})};}};}};}};}
  };
 }}};
}
test('rejecting a pending report clears publication and verification metadata',async()=>{
 const x=dbWith('pending');
 const r=await changeReportStatus(x.db,{report_id:id,action:'reject',reason:'Report identity could not be independently verified'});
 assert.equal(r.ok,true);assert.equal(r.report.status,'rejected');
 assert.equal(x.writes[0].publication_approved,false);
 assert.equal(x.writes[0].reviewer,null);
});
test('withdrawing a verified report revokes publication eligibility',async()=>{
 const x=dbWith('verified');
 const r=await changeReportStatus(x.db,{report_id:id,action:'withdraw',reason:'Supplier has withdrawn this source report'});
 assert.equal(r.ok,true);assert.equal(r.report.publication_approved,false);
 assert.equal(r.publicly_verified,false);
});
test('rejection of verified reports and invalid actions fail without writes',async()=>{
 const x=dbWith('verified');
 const a=await changeReportStatus(x.db,{report_id:id,action:'reject',reason:'This report requires withdrawal'});
 assert.equal(a.ok,false);assert.equal(x.writes.length,0);
 const b=await changeReportStatus(x.db,{report_id:id,action:'approve',reason:'No verification evidence provided'});
 assert.equal(b.ok,false);assert.equal(x.writes.length,0);
});
test('admin UI exposes withdrawal and rejection but no self-verification button',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../admin-inventory.html'),'utf8');
 assert.match(html,/coa-review-form/);
 assert.match(html,/Withdraw report/);
 assert.doesNotMatch(html,/Approve as verified/);
});
