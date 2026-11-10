'use strict';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIONS=new Set(['reject','withdraw']);
async function changeReportStatus(db,input){
 if(!input||!UUID.test(input.report_id||'')||!ACTIONS.has(input.action)||
    typeof input.reason!=='string'||input.reason.trim().length<12||
    input.reason.trim().length>500)return {ok:false,reason:'INVALID_REVIEW_REQUEST'};
 // The database function atomically locks the report, changes its status
 // and appends the reasoned review event. No direct UPDATE is allowed.
 const {data,error}=await db.rpc('enterprise_review_quality_document',{
  p_report_id:input.report_id,
  p_action:input.action,
  p_reason:input.reason.trim(),
  p_actor_reference:'admin-quality-console'
 });
 if(error){
  if(['P0001','P0002','22023'].includes(error.code))
   return {ok:false,reason:'REVIEW_TRANSITION_DENIED'};
  throw Error('Quality review transaction unavailable.');
 }
 if(!data||!['rejected','withdrawn'].includes(data.status)||data.publication_approved!==false)
  throw Error('Unexpected review response.');
 return {ok:true,report:data,publicly_verified:false,audit_recorded:true};
}
module.exports={changeReportStatus};
