'use strict';
const { randomUUID } = require('node:crypto');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIONS=new Set(['reject','withdraw']);

/**
 * A shared admin password authenticates the console, but does not authenticate
 * an individual human reviewer. Record a unique server-issued action reference
 * for audit correlation. Never accept an actor reference from browser input.
 */
async function changeReportStatus(db,input){
 if(!input||!UUID.test(input.report_id||'')||!ACTIONS.has(input.action)||
    typeof input.reason!=='string'||input.reason.trim().length<12||
    input.reason.trim().length>500)return {ok:false,reason:'INVALID_REVIEW_REQUEST'};
 const reviewReference='admin-shared-key-request:'+randomUUID();
 // The database function atomically locks the report, changes its status
 // and appends a reasoned review event; no direct UPDATE is permitted.
 const {data,error}=await db.rpc('enterprise_review_quality_document',{
  p_report_id:input.report_id,
  p_action:input.action,
  p_reason:input.reason.trim(),
  p_actor_reference:reviewReference
 });
 if(error){
  if(['P0001','P0002','22023'].includes(error.code))
   return {ok:false,reason:'REVIEW_TRANSITION_DENIED'};
  throw Error('Quality review transaction unavailable.');
 }
 if(!data||!['rejected','withdrawn'].includes(data.status)||data.publication_approved!==false)
  throw Error('Unexpected review response.');
 console.info('COA review action recorded',{review_reference:reviewReference,action:input.action});
 return {ok:true,report:data,publicly_verified:false,audit_recorded:true,review_reference:reviewReference};
}
module.exports={changeReportStatus};
