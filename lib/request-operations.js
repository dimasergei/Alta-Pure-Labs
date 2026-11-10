'use strict';
const {createHash,randomUUID}=require('node:crypto');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const STATUSES=new Set(['new','in_review','waiting_customer','resolved','spam']);
const EMAIL=/^[^\s@\r\n]+@[^\s@\r\n]+\.[^\s@\r\n]+$/;
function error(status,message){const e=Error(message);e.status=status;return e;}
function checked(result){if(result.error)throw result.error;return result.data;}
function reference(id){return 'REQ-'+id.toUpperCase();}
function emailEnvelope(inquiry,env=process.env){
 if(!env.ORDER_CONFIRMATION_FROM||!EMAIL.test(env.ADMIN_ORDER_EMAIL||''))return null;
 const lines=[`AltaPure ${inquiry.type} request`,reference(inquiry.request_id),`Name: ${inquiry.name}`,`Email: ${inquiry.email}`,
  `Organization: ${inquiry.organization||'Not provided'}`,`Country: ${inquiry.country||'Not provided'}`,`Topic: ${inquiry.topic||inquiry.type}`,'',inquiry.message];
 if(inquiry.items?.length){lines.push('','Requested variants (catalog estimate only):');for(const x of inquiry.items)lines.push(`${x.name} | ${x.size} | ${x.quantity} units | USD ${(x.unit_price_cents/100).toFixed(2)} each`);lines.push('Shipping, taxes and commercial terms are not included.');}
 lines.push('','Manage this request in the authenticated operations inbox at https://altapurelabs.com/admin-operations.html.');
 return {from:env.ORDER_CONFIRMATION_FROM,to:[env.ADMIN_ORDER_EMAIL],reply_to:inquiry.email,subject:`AltaPure ${inquiry.type} inquiry · ${reference(inquiry.request_id)}`,text:lines.join('\n')};
}
async function storeRequest(db,inquiry,env=process.env){
 const digest=createHash('sha256').update(JSON.stringify(inquiry)).digest('hex');
 const result=await db.rpc('enterprise_submit_customer_request',{p_id:inquiry.request_id,p_digest:digest,p_payload:inquiry,p_email_payload:emailEnvelope(inquiry,env)});
 if(result.error){if(result.error.code==='23505')throw error(409,'This request ID was used for different details. Reload the form and submit again.');throw error(503,'Your request was not saved. Please try again or contact us by email.');}
 if(!result.data||result.data.id!==inquiry.request_id)throw error(503,'The request could not be confirmed.');
 return result.data;
}
async function deliverRequest(db,id,env=process.env,fetchImpl=fetch){
 if(!UUID.test(id))throw error(400,'Invalid request.');
 if(!env.RESEND_API_KEY)return {email_status:'queued'};
 const record=checked(await db.from('enterprise_customer_requests').select('id,payload,email_status').eq('id',id).maybeSingle());
 if(!record)throw error(404,'Request not found.');
 const claim=checked(await db.rpc('enterprise_claim_request_email',{p_id:id,p_email_payload:emailEnvelope(record.payload,env)}));
 if(!claim?.claimed)return {email_status:claim?.email_status||record.email_status};
 let outcome='failed',provider=null,errorCode='transport_failed';
 try{
  const r=await fetchImpl('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'altapure-request/'+id},body:JSON.stringify(claim.email_payload),signal:AbortSignal.timeout(12000)});
  const data=await r.json().catch(()=>null);
  if(r.ok&&typeof data?.id==='string'){outcome='accepted';provider=data.id;errorCode=null;}else errorCode='provider_http_'+String(r.status||'unknown');
 }catch{errorCode='transport_uncertain';}
 const finished=await db.rpc('enterprise_finish_request_email',{p_id:id,p_claim:claim.claim,p_outcome:outcome,p_provider_id:provider,p_error:errorCode});
 if(finished.error||finished.data!==true)return {email_status:'sending'};
 return {email_status:outcome};
}
function pageOffset(params){const raw=params.get('offset')||'0';if(!/^\d{1,6}$/.test(raw)||Number(raw)>10000)throw error(400,'Invalid page.');return Number(raw);}
async function listRequests(db,params){
 const offset=pageOffset(params),status=params.get('status'),kind=params.get('kind');
 if(status&&!STATUSES.has(status))throw error(400,'Invalid status.');
 if(kind&&!['contact','bulk','partner','updates'].includes(kind))throw error(400,'Invalid type.');
 let q=db.from('enterprise_customer_requests').select('id,kind,customer_name,customer_email,status,assigned_to,version,email_status,email_attempts,created_at,updated_at',{count:'exact'});
 if(status)q=q.eq('status',status);if(kind)q=q.eq('kind',kind);
 const r=await q.order('created_at',{ascending:false}).order('id',{ascending:false}).range(offset,offset+24);
 const rows=checked(r)||[];
 return {requests:rows,total:r.count??null,offset,has_more:typeof r.count==='number'?offset+rows.length<r.count:rows.length===25};
}
async function requestDetail(db,id){
 if(!UUID.test(id||''))throw error(400,'Invalid request.');
 const record=checked(await db.from('enterprise_customer_requests').select('id,kind,customer_name,customer_email,payload,status,assigned_to,public_reply,version,email_status,email_attempts,last_email_error,created_at,updated_at').eq('id',id).maybeSingle());
 if(!record)throw error(404,'Request not found.');
 const events=checked(await db.from('enterprise_customer_request_events').select('id,kind,actor_reference,details,created_at').eq('request_id',id).order('created_at',{ascending:false}).limit(100));
 return {request:record,events:events||[]};
}
async function updateRequest(db,body){
 if(!UUID.test(body.request_id||'')||!Number.isSafeInteger(body.version)||body.version<1||!STATUSES.has(body.status)||typeof body.note!=='string'||body.note.trim().length<3||body.note.length>2000)throw error(400,'A valid request, version, status, and internal note are required.');
 for(const [key,limit] of [['public_reply',4000],['assigned_to',120]])if(body[key]!==undefined&&(typeof body[key]!=='string'||body[key].length>limit))throw error(400,'Invalid '+key+'.');
 const r=await db.rpc('enterprise_update_customer_request',{p_id:body.request_id,p_expected_version:body.version,p_status:body.status,p_note:body.note.trim(),p_public_reply:body.public_reply||'',p_assigned_to:body.assigned_to||'',p_actor:'admin-shared-key-request:'+randomUUID()});
 if(r.error){if(r.error.code==='40001')throw error(409,'This request changed. Reload it before saving.');if(r.error.code==='P0002')throw error(404,'Request not found.');throw error(503,'Request could not be updated.');}
 return {updated:true,request:r.data};
}
async function customerRequests(req,res,db){
 const token=/^Bearer ([A-Za-z0-9._~-]{20,8192})$/.exec(req.headers?.authorization||'');
 if(!token)return res.status(401).json({error:'Sign in to view your requests.'});
 const {data,error:authError}=await db.auth.getUser(token[1]);const user=data?.user;
 if(authError||!user?.email||!user.email_confirmed_at)return res.status(401).json({error:'Sign in again with a verified email.'});
 const params=new URL(req.url,'https://account.internal').searchParams,offset=pageOffset(params);
 const r=await db.from('enterprise_customer_requests').select('id,kind,status,public_reply,created_at,updated_at',{count:'exact'})
  .eq('customer_email',user.email.trim().toLowerCase()).order('created_at',{ascending:false}).order('id',{ascending:false}).range(offset,offset+24);
 const rows=checked(r)||[];
 res.setHeader('Vary','Authorization');
 return res.status(200).json({requests:rows.map(x=>({...x,reference:reference(x.id)})),offset,has_more:typeof r.count==='number'?offset+rows.length<r.count:rows.length===25});
}
module.exports={reference,storeRequest,deliverRequest,listRequests,requestDetail,updateRequest,customerRequests,emailEnvelope};
