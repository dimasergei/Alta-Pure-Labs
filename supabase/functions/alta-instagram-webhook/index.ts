// Meta Instagram webhooks; this public endpoint requires Meta HMAC signatures on every POST.
// Set INSTAGRAM_APP_SECRET and INSTAGRAM_WEBHOOK_VERIFY_TOKEN as Supabase Edge Function secrets.
const headers={'content-type':'text/plain; charset=utf-8','cache-control':'no-store'};
function plain(body:string,status=200){return new Response(body,{status,headers});}
async function signatureValid(body:ArrayBuffer,signature:string,secret:string){
  const value=signature.match(/^sha256=([a-fA-F0-9]{64})$/)?.[1];
  if(!value||!secret)return false;
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const raw=new Uint8Array(await crypto.subtle.sign('HMAC',key,body));
  const expected=Array.from(raw,b=>b.toString(16).padStart(2,'0')).join('');
  let diff=0;for(let i=0;i<64;i++)diff|=expected.charCodeAt(i)^value.toLowerCase().charCodeAt(i);
  return diff===0;
}
Deno.serve(async(request:Request)=>{
  const secret=Deno.env.get('INSTAGRAM_APP_SECRET')||'';
  const verify=Deno.env.get('INSTAGRAM_WEBHOOK_VERIFY_TOKEN')||'';
  if(!secret||!verify)return plain('Instagram webhook is not configured',503);
  if(request.method==='GET'){
    const u=new URL(request.url);
    const mode=u.searchParams.get('hub.mode'),token=u.searchParams.get('hub.verify_token'),challenge=u.searchParams.get('hub.challenge');
    if(mode!=='subscribe'||token!==verify||!challenge||challenge.length>512)return plain('Verification failed',403);
    return plain(challenge);
  }
  if(request.method!=='POST')return plain('Method not allowed',405);
  let raw:ArrayBuffer;
  try{raw=await request.arrayBuffer();}catch{return plain('Invalid payload',400);}
  if(raw.byteLength>1000000)return plain('Payload too large',413);
  if(!await signatureValid(raw,request.headers.get('x-hub-signature-256')||'',secret))return plain('Invalid signature',403);
  let payload:any;
  try{payload=JSON.parse(new TextDecoder().decode(raw));}catch{return plain('Invalid JSON',400);}
  if(payload?.object!=='instagram'||!Array.isArray(payload.entry))return plain('Ignored',200);
  const rows:any[]=[];
  for(const entry of payload.entry.slice(0,50)){
    const igId=String(entry?.id||'');
    if(!/^\d{5,30}$/.test(igId))continue;
    for(const event of (Array.isArray(entry.messaging)?entry.messaging:[]).slice(0,50)){
      const mid=String(event?.message?.mid||'');
      const sender=String(event?.sender?.id||''),recipient=String(event?.recipient?.id||'');
      if(!mid||mid.length>512||!/^\d{5,30}$/.test(sender)||!/^\d{5,30}$/.test(recipient))continue;
      if(event.message?.is_echo)continue;
      const incoming=sender!==igId,participant=incoming?sender:recipient;
      const text=typeof event.message.text==='string'?event.message.text.slice(0,4000):
         event.message?.attachments?'[Media attachment]':'[Message]';
      const stamp=Number(event.timestamp),date=Number.isFinite(stamp)&&stamp>1000000000000?new Date(stamp):new Date();
      rows.push({provider_message_id:mid,ig_user_id:igId,participant_id:participant,
        direction:incoming?'incoming':'outgoing',body:text,message_at:date.toISOString()});
    }
  }
  if(!rows.length)return plain('OK');
  const url=Deno.env.get('SUPABASE_URL')||'',serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
  if(!url||!serviceKey)return plain('Webhook storage unavailable',503);
  const u=new URL('/rest/v1/ap_marketing_ig_messages',url);
  u.searchParams.set('on_conflict','provider_message_id');
  try{
    const response=await fetch(u,{method:'POST',headers:{
      apikey:serviceKey,Authorization:'Bearer '+serviceKey,'Content-Type':'application/json',
      Prefer:'resolution=ignore-duplicates,return=minimal'
    },body:JSON.stringify(rows)});
    if(!response.ok)return plain('Message storage unavailable',503);
    return plain('OK');
  }catch{return plain('Message storage unavailable',503);}
});
