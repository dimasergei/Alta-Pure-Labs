'use strict';
const {configuration}=require('./lotus-supplier');
const BASE='https://partners.lotuspeptide.com/api/v1';
class LotusError extends Error {constructor(status,code){super('Lotus request could not be completed.');this.status=status;this.code=code;this.retryable=status===429||status>=500||status===0;}}
function cents(value){if(typeof value!=='string'||!/^\d{1,7}\.\d{2}$/.test(value))throw new LotusError(422,'invalid_money');const [a,b]=value.split('.');return Number(a)*100+Number(b);}
function client({env=process.env,fetchImpl=fetch}={}){
 const c=configuration(env);if(!c.configured)throw new LotusError(503,'api_not_configured');
 async function request(method,path,body){
  if(!/^\/(products|pricing|quote|orders(?:\?reference=[A-Za-z0-9%_.-]+|\/[A-Za-z0-9_-]+(?:\/cancel|\/label)?)?)$/.test(path))throw new LotusError(400,'invalid_path');
  let r;try{r=await fetchImpl(BASE+path,{method,redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+env.LOTUS_PARTNER_API_KEY,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});}catch{throw new LotusError(0,'network_error');}
  let data;try{data=await r.json();}catch{throw new LotusError(r.status>=500?r.status:502,'invalid_response');}
  if(!r.ok)throw new LotusError(r.status,/^[a-z_]{1,60}$/.test(data.error?.code)?data.error.code:'provider_error');
  return data;
 }
 const id=id=>{if(!/^[A-Za-z0-9_-]{1,100}$/.test(id))throw new LotusError(400,'invalid_id');return id;};
 return {mode:c.mode,products:()=>request('GET','/products'),pricing:()=>request('GET','/pricing'),quote:lines=>request('POST','/quote',{lines}),create:payload=>request('POST','/orders',payload),find:reference=>request('GET','/orders?reference='+encodeURIComponent(reference)),get:orderId=>request('GET','/orders/'+id(orderId)),cancel:orderId=>request('POST','/orders/'+id(orderId)+'/cancel',{reason:'AltaPure order canceled or fully refunded.'})};
}
module.exports={client,LotusError,cents};
