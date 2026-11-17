'use strict';
// Native USDC receipt verification. The server never signs or broadcasts a transfer.
const {randomBytes,randomUUID,createHash}=require('node:crypto');
const {Interface,TypedDataEncoder,verifyTypedData,Signature}=require('ethers');
const CHAIN_ID=137,TOKEN='0x3c499c542cef5e3811e1192ce70d8cc03d5c3359';
const ADDRESS=/^0x[a-f0-9]{40}$/i,HASH=/^0x[a-f0-9]{64}$/i,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const ZERO='0x'+'0'.repeat(40),DOMAIN={name:'USD Coin',version:'2',chainId:CHAIN_ID,verifyingContract:TOKEN};
const TYPES={TransferWithAuthorization:[{name:'from',type:'address'},{name:'to',type:'address'},{name:'value',type:'uint256'},{name:'validAfter',type:'uint256'},{name:'validBefore',type:'uint256'},{name:'nonce',type:'bytes32'}]};
const ABI=new Interface([
 'function name() view returns(string)','function version() view returns(string)','function decimals() view returns(uint8)','function DOMAIN_SEPARATOR() view returns(bytes32)',
 'function authorizationState(address,bytes32) view returns(bool)',
 'function transferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,uint8 v,bytes32 r,bytes32 s)',
 'event AuthorizationUsed(address indexed authorizer,bytes32 indexed nonce)','event Transfer(address indexed from,address indexed to,uint256 value)'
]);
const error=(status,message)=>Object.assign(Error(message),{status});
const fail=(status,message)=>{throw error(status,message);};
const lower=value=>String(value||'').toLowerCase();
const goodAddress=value=>ADDRESS.test(value||'')&&lower(value)!==ZERO;
const checked=result=>{if(result.error)fail(409,'Crypto payment state could not be confirmed. Check the saved order before trying again.');return result.data;};
function rpcURL(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.hash?u.href:null;}catch{return null;}}
function configuration(env=process.env){
 const recipient=lower(env.POLYGON_USDC_RECIPIENT),missing=[];
 if(!goodAddress(recipient))missing.push('POLYGON_USDC_RECIPIENT');
 const rpc=rpcURL(env.POLYGON_USDC_RPC_URL),secondary=rpcURL(env.POLYGON_USDC_SECONDARY_RPC_URL);
 if(!rpc)missing.push('POLYGON_USDC_RPC_URL');
 if(!secondary||(rpc&&new URL(secondary).hostname===new URL(rpc).hostname))missing.push('POLYGON_USDC_SECONDARY_RPC_URL');
 const enabled=env.POLYGON_USDC_ENABLED==='true';
 return{provider:'polygon_usdc',mode:'live',enabled,ready:enabled&&!missing.length,missing,currencies:['USD'],recipient,chain_id:CHAIN_ID,token:TOKEN,rpc,secondary,
  account_tag:goodAddress(recipient)?createHash('sha256').update('polygon_usdc:live:137:'+TOKEN+':'+recipient).digest('hex'):null,three_ds:false,wallets:{apple:false,google:false}};
}
async function rpc(url,method,params,fetchImpl=fetch){
 let response,data;
 try{
  response=await fetchImpl(url,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(10000)});
  const cap=131072,declared=response.headers?.get('content-length');
  if(declared&&(!/^\d+$/.test(declared)||Number(declared)>cap))throw Error('response limit');
  const reader=response.body?.getReader();if(!reader)throw Error('unbounded response');
  const chunks=[];let size=0;
  try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>cap)throw Error('response limit');chunks.push(Buffer.from(part.value));}}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  data=JSON.parse(Buffer.concat(chunks,size).toString('utf8'));
 }catch{fail(503,'Polygon verification is temporarily unavailable. Your payment remains pending.');}
 if(!response.ok||data?.jsonrpc!=='2.0'||data.id!==1||data.error||!Object.hasOwn(data,'result'))fail(503,'Polygon verification is temporarily unavailable. Your payment remains pending.');
 return data.result;
}
const quantity=value=>{if(typeof value!=='string'||!/^0x[0-9a-f]+$/i.test(value))fail(503,'Polygon returned an invalid block reference.');return BigInt(value);};
const safeQuantity=(value,max=Number.MAX_SAFE_INTEGER)=>{const n=quantity(value);if(n>BigInt(max))fail(503,'Polygon returned an invalid block index.');return Number(n);};
async function finality(url,fetchImpl){
 if(quantity(await rpc(url,'eth_chainId',[],fetchImpl))!==137n)fail(503,'The configured network is not Polygon.');
 const block=await rpc(url,'eth_getBlockByNumber',['finalized',false],fetchImpl);
 if(!block||!HASH.test(block.hash||''))fail(503,'Polygon finality could not be verified.');
 return{number:BigInt(safeQuantity(block.number)),hash:lower(block.hash),timestamp:safeQuantity(block.timestamp)};
}
async function tokenCall(url,name,args=[],block='latest',fetchImpl=fetch){
 const raw=await rpc(url,'eth_call',[{to:TOKEN,data:ABI.encodeFunctionData(name,args)},block],fetchImpl);
 try{return ABI.decodeFunctionResult(name,raw)[0];}catch{fail(503,'The native USDC contract could not be verified.');}
}
const readinessCache=new Map();
async function readiness(env=process.env,fetchImpl=fetch){
 const c=configuration(env),base={provider:c.provider,enabled:c.enabled,configured:!c.missing.length,operational:false,ready:false,missing:c.missing,chain_id:CHAIN_ID,token:TOKEN,recipient_tail:goodAddress(c.recipient)?c.recipient.slice(-6):null,checked_at:new Date().toISOString(),checks:{}};
 if(c.missing.length)return base;
 const key=createHash('sha256').update([c.account_tag,c.rpc,c.secondary].join('|')).digest('hex'),cache=readinessCache.get(key);
 if(fetchImpl===fetch&&cache&&cache.until>Date.now())return{...cache.result,enabled:c.enabled,ready:c.enabled&&cache.result.operational};
 try{
  for(const url of [c.rpc,c.secondary].filter(Boolean)){
   const [block,name,version,decimals,domain]=await Promise.all([finality(url,fetchImpl),tokenCall(url,'name',[],'latest',fetchImpl),tokenCall(url,'version',[],'latest',fetchImpl),tokenCall(url,'decimals',[],'latest',fetchImpl),tokenCall(url,'DOMAIN_SEPARATOR',[],'latest',fetchImpl)]);
   if(name!==DOMAIN.name||version!==DOMAIN.version||decimals!==6n||lower(domain)!==lower(TypedDataEncoder.hashDomain(DOMAIN)))fail(503,'Native USDC metadata does not match the pinned Polygon configuration.');
   base.finalized_block_number=block.number.toString();
  }
  base.checks={chain:true,token:true,decimals:true,domain:true,finality:true};base.operational=true;base.ready=c.enabled;
 }catch{base.error='Polygon verification unavailable.';}
 if(fetchImpl===fetch)readinessCache.set(key,{until:Date.now()+30000,result:base});
 return base;
}
function message(intent){return{from:intent.payer,to:intent.recipient,value:String(intent.amount_units),validAfter:Number(intent.valid_after),validBefore:Number(intent.valid_before),nonce:intent.nonce};}
function publicIntent(intent){
 if(!intent)return{state:'not_started'};
 return{state:intent.status==='paid'?'paid':intent.status==='review'?'review':intent.status==='expired'?'expired':intent.candidate_tx_hash?'pending':'awaiting_wallet',
  intent:{attempt_id:intent.attempt_id,invoice_id:intent.invoice_id,chain_id:CHAIN_ID,token:TOKEN,recipient:intent.recipient,payer:intent.payer,amount_units:String(intent.amount_units),nonce:intent.nonce,valid_after:Number(intent.valid_after),valid_before:Number(intent.valid_before),tx_hash:intent.candidate_tx_hash||null},
  authorization:{domain:DOMAIN,types:TYPES,primaryType:'TransferWithAuthorization',message:message(intent)}};
}
async function loadIntent(db,invoiceId,attemptId){
 let query=db.from('commerce_polygon_usdc_intents').select('*').eq('invoice_id',invoiceId);
 if(attemptId)query=query.eq('attempt_id',attemptId);else query=query.order('created_at',{ascending:false}).limit(1);
 return checked(await query.maybeSingle());
}
function owner(i,u){if(!u?.id||u.id!==i.customer_id)fail(403,'This crypto payment belongs to another account.');}
function binding(intent,i,a,c){
 if(!intent||intent.invoice_id!==i.id||intent.account_tag!==a.account_tag||a.account_tag!==c.account_tag||a.provider!=='polygon_usdc'||a.mode!=='live'||lower(intent.recipient)!==c.recipient||lower(intent.token)!==TOKEN||Number(intent.chain_id)!==CHAIN_ID||BigInt(intent.amount_units)!==BigInt(i.total_cents)*10000n)fail(409,'The crypto payment does not match this saved order and receiving route.');
}
async function customerState(db,i,u,env=process.env){owner(i,u);return publicIntent(await loadIntent(db,i.id));}
async function start(db,i,a,c,body,u,env=process.env,fetchImpl=fetch){
 owner(i,u);
 if(!c.ready||a.provider!=='polygon_usdc'||a.account_tag!==c.account_tag||i.currency!=='USD'||i.kind!=='goods'||i.status!=='accepted'||Date.parse(i.expires_at)<=Date.now()||body.confirm_amount_cents!==i.total_cents||body.confirm_currency!=='USD'||body.consent!==true)fail(409,'Review the current order and available crypto payment route.');
 const payer=lower(body.wallet_address);if(!goodAddress(payer))fail(400,'Connect a compatible Polygon wallet.');
 const old=await loadIntent(db,i.id);if(old){binding(old,i,a,c);if(old.payer!==payer)fail(409,'Reconnect the wallet originally selected for this saved payment.');return publicIntent(old);}
 const ready=await readiness(env,fetchImpl);if(!ready.operational)fail(503,'Polygon verification is unavailable. No payment authorization was created.');
 if(await rpc(c.rpc,'eth_getCode',[payer,'latest'],fetchImpl)!=='0x')fail(400,'This checkout currently supports standard externally owned wallets. Choose Card for a smart-contract wallet.');
 const block=await finality(c.rpc,fetchImpl),now=Math.floor(Date.now()/1000),validBefore=Math.min(now+1800,Math.floor(Date.parse(i.expires_at)/1000));
 if(validBefore<now+60)fail(409,'This order is expiring. Review a new order before authorizing a transfer.');
 const id=UUID.test(body.attempt_id||'')?body.attempt_id:randomUUID();
 const intent={chain_id:CHAIN_ID,token:TOKEN,recipient:c.recipient,payer,amount_units:(BigInt(i.total_cents)*10000n).toString(),nonce:'0x'+randomBytes(32).toString('hex'),valid_after:Math.min(now,block.timestamp)-60,valid_before:validBefore,start_block:block.number.toString()};
 const created=checked(await db.rpc('commerce_create_polygon_usdc_intent',{p_id:id,p_invoice:i.id,p_customer:u.id,p_account_tag:c.account_tag,p_intent:intent}));
 binding(created,i,a,c);if(created.payer!==payer)fail(409,'Reconnect the wallet originally selected for this saved payment.');
 return publicIntent(created);
}
function decodeTransfer(tx,intent){
 if(!tx||lower(tx.to)!==TOKEN||quantity(tx.value||'0x0')!==0n)fail(409,'This transaction is not the authorized native USDC transfer.');
 let decoded;try{decoded=ABI.parseTransaction({data:tx.input||tx.data,value:0});}catch{fail(409,'The transaction does not contain this order authorization.');}
 if(decoded?.name!=='transferWithAuthorization'||decoded.args.length!==9)fail(409,'Use the exact order authorization, not a plain wallet transfer.');
 const [from,to,value,validAfter,validBefore,nonce,v,r,s]=decoded.args,expected=message(intent);
 if(lower(from)!==intent.payer||lower(to)!==intent.recipient||value!==BigInt(expected.value)||validAfter!==BigInt(expected.validAfter)||validBefore!==BigInt(expected.validBefore)||lower(nonce)!==intent.nonce)fail(409,'The transaction authorization belongs to a different order.');
 try{if(lower(verifyTypedData(DOMAIN,TYPES,expected,Signature.from({v:Number(v),r,s})))!==intent.payer)throw Error('signer');}catch{fail(409,'The wallet authorization signature is invalid.');}
}
async function proofAt(url,intent,hash,fetchImpl){
 const [block,tx,receipt]=await Promise.all([finality(url,fetchImpl),rpc(url,'eth_getTransactionByHash',[hash],fetchImpl),rpc(url,'eth_getTransactionReceipt',[hash],fetchImpl)]);
 if(!tx)return{pending:true};
 if(lower(tx.hash)!==hash)fail(503,'Polygon transaction reference mismatch.');decodeTransfer(tx,intent);
 if(!receipt||!receipt.blockNumber)return{pending:true,submitted:true};
 if(lower(receipt.transactionHash)!==hash||quantity(receipt.status)!==1n)fail(409,'This transaction did not complete the USDC payment.');
 const number=BigInt(safeQuantity(receipt.blockNumber)),index=safeQuantity(receipt.transactionIndex,2147483647);
 if(number>block.number)return{pending:true,submitted:true};
 if(number<BigInt(intent.start_block)||safeQuantity(tx.blockNumber)!==Number(number)||safeQuantity(tx.transactionIndex,2147483647)!==index||!goodAddress(tx.from)||lower(receipt.from)!==lower(tx.from)||lower(receipt.to)!==TOKEN||receipt.contractAddress)fail(503,'The receipt does not match its transaction.');
 const canonical=await rpc(url,'eth_getBlockByNumber',[receipt.blockNumber,false],fetchImpl);
 if(!canonical||!HASH.test(receipt.blockHash||'')||safeQuantity(canonical.number)!==Number(number)||lower(canonical.hash)!==lower(receipt.blockHash)||lower(tx.blockHash)!==lower(receipt.blockHash)||!Array.isArray(canonical.transactions)||lower(canonical.transactions[index])!==hash)fail(503,'The payment block is not final on the canonical Polygon chain.');
 const timestamp=safeQuantity(canonical.timestamp);if(timestamp<=Number(intent.valid_after)||timestamp>=Number(intent.valid_before)||timestamp>block.timestamp)fail(409,'The authorization was not settled within its validity window.');
 const matching=[],authorizations=[];
 for(const log of receipt.logs||[]){
  if(lower(log.address)!==TOKEN||log.removed===true)continue;
  let parsed;try{parsed=ABI.parseLog(log);}catch{continue;}
  if(parsed?.name==='AuthorizationUsed'&&lower(parsed.args.authorizer)===intent.payer&&lower(parsed.args.nonce)===intent.nonce)authorizations.push(log);
  if(parsed?.name==='Transfer'&&lower(parsed.args.from)===intent.payer&&lower(parsed.args.to)===intent.recipient&&parsed.args.value===BigInt(intent.amount_units))matching.push(log);
 }
 if(authorizations.length!==1||matching.length!==1)fail(409,'The finalized receipt does not contain the exact authorized USDC payment.');
 for(const log of [...authorizations,...matching]){
  if(lower(log.transactionHash)!==hash||lower(log.blockHash)!==lower(receipt.blockHash)||safeQuantity(log.blockNumber)!==Number(number)||safeQuantity(log.transactionIndex,2147483647)!==index)fail(503,'The token receipt does not match its transaction block.');
  safeQuantity(log.logIndex,2147483647);
 }
 if(quantity(authorizations[0].logIndex)===quantity(matching[0].logIndex))fail(503,'The token receipt has duplicate log indices.');
 return{chain_id:CHAIN_ID,token:TOKEN,recipient:intent.recipient,payer:intent.payer,nonce:intent.nonce,amount_units:String(intent.amount_units),tx_hash:hash,log_index:safeQuantity(matching[0].logIndex,2147483647),block_number:number.toString(),block_hash:lower(receipt.blockHash),block_timestamp:timestamp,finalized_number:block.number.toString()};
}
async function locate(url,intent,fetchImpl){
 const block=await finality(url,fetchImpl),start=BigInt(intent.start_block);let until=block.number;
 // A 30-minute authorization remains recoverable long after the browser closes.
 // Bound history by its immutable validity window, rather than by today's height.
 if(block.timestamp>=Number(intent.valid_before)){
  let low=start,high=until;
  while(low<high){const mid=(low+high+1n)/2n,b=await rpc(url,'eth_getBlockByNumber',['0x'+mid.toString(16),false],fetchImpl);if(!b||BigInt(safeQuantity(b.number))!==mid)fail(503,'Polygon history is unavailable.');if(safeQuantity(b.timestamp)<Number(intent.valid_before))low=mid;else high=mid-1n;}
  until=low;
 }
 if(until-start>10000n)fail(409,'This older payment requires reconciliation by support.');
 const topics=ABI.encodeFilterTopics('AuthorizationUsed',[intent.payer,intent.nonce]);let found=null;
 for(let from=start;from<=until;from+=2000n){
  const to=from+1999n<until?from+1999n:until;
  const logs=await rpc(url,'eth_getLogs',[{address:TOKEN,fromBlock:'0x'+from.toString(16),toBlock:'0x'+to.toString(16),topics}],fetchImpl);
  if(!Array.isArray(logs)||logs.length>1)fail(503,'Polygon authorization history is ambiguous.');
  for(const log of logs){
   if(log.removed===true)continue;
   let parsed;try{parsed=ABI.parseLog(log);}catch{fail(503,'Polygon authorization history is invalid.');}
   if(lower(log.address)!==TOKEN||parsed?.name!=='AuthorizationUsed'||lower(parsed.args.authorizer)!==intent.payer||lower(parsed.args.nonce)!==intent.nonce||!HASH.test(log.transactionHash||''))fail(503,'Polygon authorization history is invalid.');
   const height=BigInt(safeQuantity(log.blockNumber));if(height<from||height>to)fail(503,'Polygon authorization history is outside the requested range.');
   if(found&&found!==lower(log.transactionHash))fail(409,'This authorization needs review.');found=lower(log.transactionHash);
  }
 }
 return found;
}
async function confirm(db,i,a,c,body,u,env=process.env,fetchImpl=fetch,{dispatch=true}={}){
 owner(i,u);if(!UUID.test(body.attempt_id||''))fail(400,'Invalid crypto attempt.');
 const intent=await loadIntent(db,i.id,body.attempt_id);binding(intent,i,a,c);
 if(intent.status==='paid')return{state:'paid',invoice_id:i.id};
 if(intent.status==='review')return{state:'review',invoice_id:i.id};
 if(c.missing.length)fail(503,'Polygon verification is temporarily unavailable. Your payment remains pending.');
 let hash=body.tx_hash||intent.candidate_tx_hash;if(hash&&!HASH.test(hash))fail(400,'Invalid Polygon transaction reference.');hash=hash?lower(hash):null;
 let proof=null,invalid=null;
 if(hash){try{proof=await proofAt(c.rpc,intent,hash,fetchImpl);}catch(e){if(e.status!==409)throw e;invalid=e;}}
 // A wallet may replace a transaction while keeping the same signed authorization.
 // Its nonce is the order identity; an old public transaction hash never blocks recovery.
 if(!proof||proof.pending){
  const located=await locate(c.rpc,intent,fetchImpl);
  if(located&&located!==hash){hash=located;proof=await proofAt(c.rpc,intent,hash,fetchImpl);invalid=null;}
 }
 if(!proof||proof.pending){
  if(invalid&&body.tx_hash)throw invalid;
  const submitted=proof?.submitted===true;
  checked(await db.rpc('commerce_note_polygon_usdc_submission',{p_id:intent.attempt_id,p_hash:submitted?hash:null,p_account_tag:c.account_tag}));
  if(Date.now()/1000>Number(intent.valid_before)){
   try{await verifyUnpaid(db,i,env,fetchImpl);return{...publicIntent(intent),state:'expired'};}catch(e){if(e.status!==409)throw e;}
  }
  return{...publicIntent({...intent,candidate_tx_hash:submitted?hash:intent.candidate_tx_hash}),state:submitted||intent.candidate_tx_hash?'pending':'awaiting_wallet'};
 }
 const second=await proofAt(c.secondary,intent,hash,fetchImpl);if(second.pending){checked(await db.rpc('commerce_note_polygon_usdc_submission',{p_id:intent.attempt_id,p_hash:hash,p_account_tag:c.account_tag}));return{...publicIntent(intent),state:'pending'};}
 for(const key of ['tx_hash','log_index','block_number','block_hash','block_timestamp','nonce','amount_units'])if(second[key]!==proof[key])fail(503,'Independent Polygon verification has not agreed. Payment remains pending.');
 const result=checked(await db.rpc('commerce_finish_polygon_usdc_payment',{p_id:intent.attempt_id,p_account_tag:c.account_tag,p_proof:proof}));
 if(dispatch&&result.state==='paid'){try{await require('./invoice-notifications').dispatch(db,{invoiceId:i.id,env,limit:2});}catch{}}
 return result;
}
async function reconcilePending(db,{env=process.env,fetchImpl=fetch,limit=4,timeBudgetMs=35000}={}){
 const c=configuration(env),result={checked:0,paid:0,pending:0,review:0,expired:0,errors:0};
 if(c.missing.length)return{...result,skipped:true};
 const max=Math.min(10,Math.max(1,Number(limit)||4)),deadline=Date.now()+Math.min(40000,Math.max(1000,Number(timeBudgetMs)||35000));
 const boundedFetch=(url,options)=>fetchImpl(url,{...options,signal:AbortSignal.any([options.signal,AbortSignal.timeout(Math.max(1,deadline-Date.now()))])});
 const intents=checked(await db.from('commerce_polygon_usdc_intents').select('*').in('status',['open','submitted']).order('updated_at',{ascending:true}).limit(max))||[];
 for(const intent of intents){
  if(Date.now()>=deadline)break;
  try{
   const invoice=checked(await db.from('commerce_invoices').select('*').eq('id',intent.invoice_id).single()),account=checked(await db.from('commerce_gateway_accounts').select('*').eq('method_id',invoice.method_id).single());
   const done=await confirm(db,invoice,account,c,{attempt_id:intent.attempt_id},{id:invoice.customer_id},env,boundedFetch,{dispatch:false});
   if(Object.hasOwn(result,done.state))result[done.state]++;else result.pending++;
  }catch{result.errors++;}
  finally{
   result.checked++;
   // Rotate failed/pending checks so an unavailable old receipt cannot starve newer orders.
   try{checked(await db.rpc('commerce_note_polygon_usdc_submission',{p_id:intent.attempt_id,p_hash:null,p_account_tag:intent.account_tag}));}catch{}
  }
 }
 return result;
}
async function verifyUnpaid(db,invoice,env=process.env,fetchImpl=fetch){
 const c=configuration(env),intent=await loadIntent(db,invoice.id);if(!intent||intent.account_tag!==c.account_tag||c.missing.length)fail(409,'This crypto payment requires reconciliation before cancellation.');
 let last;
 for(const url of [c.rpc,c.secondary].filter(Boolean)){
  const block=await finality(url,fetchImpl);if(block.timestamp<=Number(intent.valid_before))fail(409,'The wallet authorization is still valid. Check payment status or wait until it expires before canceling.');
  if(await tokenCall(url,'authorizationState',[intent.payer,intent.nonce],'0x'+block.number.toString(16),fetchImpl))fail(409,'This authorization was used or canceled on-chain. Reconcile its receipt before canceling the order.');
  last=block;
 }
 checked(await db.rpc('commerce_release_polygon_usdc_intent',{p_id:intent.attempt_id,p_account_tag:c.account_tag,p_finalized_block:last.number.toString(),p_finalized_timestamp:last.timestamp,p_nonce_unused:true}));
 return{confirmed_unpaid:true,provider_link_may_remain_live:false};
}
module.exports={configuration,readiness,start,confirm,customerState,verifyUnpaid,reconcilePending,CHAIN_ID,TOKEN,DOMAIN,TYPES,ABI,decodeTransfer,proofAt,publicIntent};
