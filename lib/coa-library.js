'use strict';

/**
 * Public COA records are curated, verified metadata only. No supplier PDF or
 * marketing purity claim is evidence by itself.
 */
const SAFE_ID=/^[a-z0-9][a-z0-9-]{1,100}$/;
const SAFE_DATE=/^\d{4}-\d{2}-\d{2}$/;
function validDate(v) {
  if(typeof v!=='string'||!SAFE_DATE.test(v))return false;
  const d=new Date(v+'T00:00:00Z');
  return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===v;
}
function safeUrl(v,allowedHost) {
  try{
    const u=new URL(v);
    return u.protocol==='https:'&&u.username===''&&u.password===''&&
      u.hostname===allowedHost&&u.port===''&&!u.hash;
  }catch{return false;}
}
function validateReport(record) {
  if(!record||typeof record!=='object'||Array.isArray(record))return false;
  for(const key of ['id','product_id','sku_key'])if(!SAFE_ID.test(record[key]||''))return false;
  for(const key of ['lot','lab_name','report_id','reviewer','evidence_reference']) {
    if(typeof record[key]!=='string'||record[key].trim().length<2||record[key].length>180)return false;
  }
  if(!validDate(record.report_date)||!validDate(record.review_date))return false;
  if(record.status!=='verified'||record.publication_approved!==true)return false;
  if(!safeUrl(record.document_url,'altapurelabs.com'))return false;
  if(record.verification_url!==null&&record.verification_url!==undefined){
    if(typeof record.verification_url!=='string'||!record.verification_url.startsWith('https://'))return false;
    try{const u=new URL(record.verification_url);if(u.username||u.password||!u.hostname||u.port)return false;}catch{return false;}
  }
  return true;
}
function publicReports(records) {
  if(!Array.isArray(records))return [];
  const seen=new Set();
  return records.filter(r=>{
    if(!validateReport(r)||seen.has(r.id))return false;
    seen.add(r.id);
    return true;
  }).map(r=>({
    id:r.id,product_id:r.product_id,sku_key:r.sku_key,
    lot:r.lot,lab_name:r.lab_name,report_id:r.report_id,
    report_date:r.report_date,document_url:r.document_url,
    verification_url:r.verification_url||null
  }));
}
module.exports={validateReport,publicReports};
