'use strict';
const {createHash}=require('node:crypto');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validText=(v,min,max)=>typeof v==='string'&&v.trim().length>=min&&v.trim().length<=max;
function normalizeReport(input){
 if(!input||!UUID.test(input.lot_id||'')||
    !validText(input.report_id,2,120)||!validText(input.lab_name,2,180)||
    !validText(input.source_url,12,450))return null;
 let url;
 try{url=new URL(input.source_url);}catch{return null;}
 if(url.protocol!=='https:'||url.username||url.password||url.port||
    !url.hostname.includes('.')||url.hostname==='localhost'||url.hostname.endsWith('.local')||
    /^(?:\d{1,3}\.){3}\d{1,3}$/.test(url.hostname)||
    url.hostname.includes('..'))return null;
 return {
  lot_id:input.lot_id,
  report_id:input.report_id.trim(),
  lab_name:input.lab_name.trim(),
  verification_url:url.toString(),
  storage_object_key:'external-reference/'+createHash('sha256').update(url.toString()).digest('hex'),
  status:'pending',publication_approved:false,reviewer:null,reviewed_at:null
 };
}
async function intakeReport(db,input){
 const record=normalizeReport(input);
 if(!record)return {ok:false,reason:'INVALID_REPORT_METADATA'};
 const {data:lot,error:lotError}=await db.from('enterprise_inventory_lots')
  .select('id,lot_number,status').eq('id',record.lot_id).maybeSingle();
 if(lotError)throw Error('Lot lookup unavailable.');
 if(!lot)return {ok:false,reason:'LOT_NOT_FOUND'};
 if(lot.lot_number==='DEMO-NOT-A-REAL-LOT')return {ok:false,reason:'DEMO_LOT_NOT_ALLOWED'};
 const {data,error}=await db.from('enterprise_quality_documents').insert(record)
  .select('id,lot_id,report_id,status,publication_approved').single();
 if(error){
  if(error.code==='23505')return {ok:false,reason:'DUPLICATE_REPORT'};
  throw Error('Report intake unavailable.');
 }
 return {ok:true,saved:true,report:data,publication_approved:false,verified:false};
}
module.exports={normalizeReport,intakeReport};
