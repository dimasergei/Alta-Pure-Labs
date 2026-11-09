'use strict';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIONS=new Set(['reject','withdraw']);
async function changeReportStatus(db,input){
 if(!input||!UUID.test(input.report_id||'')||!ACTIONS.has(input.action)||
    typeof input.reason!=='string'||input.reason.trim().length<12||
    input.reason.trim().length>500)return {ok:false,reason:'INVALID_REVIEW_REQUEST'};
 const {data:previous,error:lookupError}=await db.from('enterprise_quality_documents')
   .select('id,status,publication_approved,lot_id').eq('id',input.report_id).maybeSingle();
 if(lookupError)throw Error('Quality report lookup unavailable.');
 if(!previous)return {ok:false,reason:'REPORT_NOT_FOUND'};
 if(input.action==='reject'&&previous.status!=='pending')
  return {ok:false,reason:'REJECTION_REQUIRES_PENDING'};
 if(input.action==='withdraw'&&!['pending','verified'].includes(previous.status))
  return {ok:false,reason:'WITHDRAWAL_NOT_ALLOWED'};
 const next=input.action==='reject'?'rejected':'withdrawn';
 const {data,error}=await db.from('enterprise_quality_documents')
  .update({status:next,publication_approved:false,reviewer:null,reviewed_at:null})
  .eq('id',previous.id).eq('status',previous.status)
  .select('id,lot_id,status,publication_approved').maybeSingle();
 if(error)throw Error('Quality report update unavailable.');
 if(!data)return {ok:false,reason:'CONCURRENT_REVIEW_CHANGE'};
 return {ok:true,report:data,publicly_verified:false};
}
module.exports={changeReportStatus};
