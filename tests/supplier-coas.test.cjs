const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {validReport,selectReports,safeUrl}=require('../supplier-coas');
const data=require('../data/supplier-coas.json');
test('every published supplier report has an exact catalog variant and explicit provenance',()=>{
 const vm=require('node:vm'),context={};vm.runInNewContext(fs.readFileSync('products.js','utf8')+';globalThis.catalog=CATALOG;',context);const catalog=context.catalog;const ids=new Set();
 for(const r of data.reports){assert(validReport(r),r.id);assert(!ids.has(r.id));ids.add(r.id);assert(catalog.find(p=>p.id===r.product_id)?.variants.some(v=>v.size===r.size),r.id);assert.match(r.sha256,/^[a-f0-9]{64}$/);assert(r.report_client&&r.lab_name&&r.publisher);assert.equal(r.inventory_lot_linked,false);}
 assert.equal(data.coverage.length,catalog.reduce((n,p)=>n+p.variants.length,0));
 for(const c of data.coverage)assert.deepEqual(c.report_ids,data.reports.filter(r=>r.product_id===c.product_id&&r.size===c.size).map(r=>r.id));
});
test('strength filtering cannot reuse a 5mg report for a 10mg selection',()=>{
 const found=selectReports(data.reports,{product:'bpc-157',size:'10mg'});assert(found.length);assert(found.every(r=>r.size==='10mg'));assert(!found.some(r=>r.lot==='BC5'));
 assert.deepEqual(selectReports(data.reports,{product:'bpc-tb-500',size:'15mg/15mg'}),[]);
});
test('unresolved identity and strength differences stay uncovered',()=>{
 for(const [product,size]of [['vip','10mg'],['ll-37','5mg'],['b-12','10mg'],['bac-3','3 mL'],['pinealon','10mg'],['cjc-ipamorelin','10mg/10mg']])assert.equal(selectReports(data.reports,{product,size}).length,0,product);
 assert.equal(selectReports(data.reports,{supplier:'peptidedropship'}).length,0);
});
test('report client, lot and laboratory are searchable without changing provenance',()=>{
 assert(selectReports(data.reports,{query:'Wholesale Peptide Supply'}).length>0);
 assert(selectReports(data.reports,{query:'Your Peptide Brand'}).length>0);
 assert(selectReports(data.reports,{query:'BC5'}).some(r=>r.id==='ypb-212'));
});
test('viewer rejects arbitrary URLs, credentials and non-HTTPS protocols',()=>{
 for(const url of ['javascript:alert(1)','http://api.purityanalytics.com/x','https://api.purityanalytics.com.evil.test/x','https://user:secret@api.purityanalytics.com/x','https://api.purityanalytics.com:444/x'])assert.equal(safeUrl(url),null);
 assert.equal(validReport({...data.reports[0],document_url:'https://evil.test/a.pdf'}),false);
 assert.equal(validReport({...data.reports[0],inventory_lot_linked:true}),false);
});
test('supplier reports never enter the verified AltaPure inventory registry',()=>assert.deepEqual(JSON.parse(fs.readFileSync('data/verified-coas.json','utf8')),[]));
