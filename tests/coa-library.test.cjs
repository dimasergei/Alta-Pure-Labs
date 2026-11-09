'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {validateReport,publicReports}=require('../lib/coa-library');
const root=path.resolve(__dirname,'..');
const record={
 id:'bpc-157-lot-001',product_id:'bpc-157',sku_key:'bpc-157-10mg',
 lot:'LOT-001',lab_name:'Example laboratory',report_id:'REPORT-001',
 reviewer:'Quality reviewer',evidence_reference:'Internal verification record',
 report_date:'2026-11-01',review_date:'2026-11-02',status:'verified',
 publication_approved:true,
 document_url:'https://altapurelabs.com/verified-coas/report-001.pdf',
 verification_url:null
};
test('empty registry publishes no fabricated COAs',()=>{
 const records=JSON.parse(fs.readFileSync(path.join(root,'data/verified-coas.json'),'utf8'));
 assert.deepEqual(records,[]);
 assert.deepEqual(publicReports(records),[]);
});
test('only individually reviewed and verified batch reports may be published',()=>{
 assert.equal(validateReport(record),true);
 for(const change of [
  {status:'pending'}, {publication_approved:false},{lot:''},
  {report_date:'2026-02-30'}, {reviewer:''},{evidence_reference:''},
  {document_url:'https://evil.example/report.pdf'},
  {document_url:'javascript:alert(1)'},
  {document_url:'https://altapurelabs.com.evil.example/report.pdf'},
  {verification_url:'javascript:alert(1)'}
 ])assert.equal(validateReport({...record,...change}),false,JSON.stringify(change));
 assert.equal(publicReports([record,{...record,id:'another-id',status:'pending'}]).length,1);
});
test('duplicate report ids are deduplicated and private review fields are excluded',()=>{
 const published=publicReports([record,record]);
 assert.equal(published.length,1);
 assert.equal(published[0].evidence_reference,undefined);
 assert.equal(published[0].reviewer,undefined);
 assert.equal(published[0].status,undefined);
});
test('COA page preserves branded styles, search and honest empty state',()=>{
 const html=fs.readFileSync(path.join(root,'coas.html'),'utf8');
 const js=fs.readFileSync(path.join(root,'coa-library.js'),'utf8');
 assert.match(html,/href="\/styles\.css"/);
 assert.match(html,/id="coa-search"/);
 assert.match(html,/id="coa-results"/);
 assert.match(html,/href="\/research-use-policy\.html"/);
 assert.match(js,/No verified certificates have been published yet/);
 assert.match(js,/publication_approved===true/);
 assert.doesNotMatch(js,/innerHTML\s*=/);
});
