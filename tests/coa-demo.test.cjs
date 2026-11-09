'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
test('demo samples contain no report, lab, URL or analytical claim',()=>{
 const samples=JSON.parse(fs.readFileSync(path.join(root,'data/coa-demo-samples.json'),'utf8'));
 assert.ok(samples.length>0);
 for(const sample of samples){
  assert.equal(sample.status,'sample_only');
  assert.equal(sample.lot,'DEMO-NOT-A-REAL-LOT');
  assert.equal(sample.report_id,null);
  assert.equal(sample.lab_name,null);
  assert.equal(sample.document_url,null);
  assert.equal(sample.purity,undefined);
  assert.equal(sample.test_results,undefined);
 }
});
test('demo UI is visually separated from verified certificates and never links to a sample PDF',()=>{
 const html=fs.readFileSync(path.join(root,'coas.html'),'utf8');
 const js=fs.readFileSync(path.join(root,'coa-demo.js'),'utf8');
 assert.match(html,/DEMONSTRATION ONLY · NOT LABORATORY DOCUMENTATION/);
 assert.match(html,/not supplier reports, not tested batches/);
 assert.match(html,/id="coa-demo-results"/);
 assert.match(html,/id="coa-results"/);
 assert.match(js,/sample\.status!=='sample_only'/);
 assert.match(js,/DEMO ONLY — NOT A COA/);
 assert.doesNotMatch(js,/createElement\('a'\)|innerHTML\s*=/);
});
test('verified registry stays empty and independent of sample records',()=>{
 const registry=JSON.parse(fs.readFileSync(path.join(root,'data/verified-coas.json'),'utf8'));
 assert.deepEqual(registry,[]);
});
