'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomBytes,randomUUID}=require('node:crypto');
let ganache,ethers;try{ganache=require('ganache');ethers=require('ethers');}catch{}
const fixture=require('./fixtures/circle-fiat-token-v2_2.json');
const polygon=require('../lib/polygon-usdc');
const hash=()=> '0x'+randomBytes(32).toString('hex');
const env=recipient=>({POLYGON_USDC_RECIPIENT:recipient,POLYGON_USDC_ENABLED:'true',POLYGON_USDC_RPC_URL:'https://primary.fixture.test',POLYGON_USDC_SECONDARY_RPC_URL:'https://secondary.fixture.test'});
async function chain(){
 const raw=ganache.provider({chain:{chainId:137},logging:{quiet:true},wallet:{deterministic:true,totalAccounts:4}}),provider=new ethers.BrowserProvider(raw);provider.pollingInterval=10;
 const owner=await provider.getSigner(0),recipient=(await provider.getSigner(2)).address.toLowerCase(),payer=new ethers.Wallet(Object.values(raw.getInitialAccounts())[1].secretKey);
 const library=await new ethers.ContractFactory(fixture.library.abi,'0x'+fixture.library.bytecode,owner).deploy();await library.waitForDeployment();
 let code=fixture.deployedBytecode;for(const refs of Object.values(fixture.linkReferences))for(const entries of Object.values(refs))for(const ref of entries)code=code.slice(0,ref.start*2)+(await library.getAddress()).slice(2).toLowerCase()+code.slice((ref.start+ref.length)*2);
 await raw.request({method:'evm_setAccountCode',params:[polygon.TOKEN,'0x'+code]});
 const token=new ethers.Contract(polygon.TOKEN,fixture.abi,owner);
 for(const [fn,args]of [['initialize',['USD Coin','USDC','USD',6,owner.address,owner.address,owner.address,owner.address]],['initializeV2',['USD Coin']],['initializeV2_1',[owner.address]],['initializeV2_2',[[],'USDC']],['configureMinter',[owner.address,1000000000n]],['mint',[payer.address,1000000000n]]])await(await token[fn](...args)).wait();
 const rpc=async(url,options)=>{
  const {method,params,id}=JSON.parse(options.body);let result;
  try{result=await raw.request({method,params:method==='eth_getBlockByNumber'&&params[0]==='finalized'?['latest',false]:params});return new Response(JSON.stringify({jsonrpc:'2.0',id,result}));}
  catch(e){return new Response(JSON.stringify({jsonrpc:'2.0',id,error:{code:e.code||-32603,message:e.message}}));}
 };
 const intent=async()=>{const b=await raw.request({method:'eth_getBlockByNumber',params:['latest',false]});return{attempt_id:randomUUID(),invoice_id:randomUUID(),account_tag:polygon.configuration(env(recipient)).account_tag,chain_id:137,token:polygon.TOKEN,recipient,payer:payer.address.toLowerCase(),amount_units:'9500000',nonce:hash(),valid_after:Number(BigInt(b.timestamp))-60,valid_before:Number(BigInt(b.timestamp))+1800,start_block:BigInt(b.number).toString(),status:'open'};};
 const authorization=i=>({from:i.payer,to:i.recipient,value:i.amount_units,validAfter:i.valid_after,validBefore:i.valid_before,nonce:i.nonce});
 const data=async(i,domain=polygon.DOMAIN)=>{const sig=ethers.Signature.from(await payer.signTypedData(domain,polygon.TYPES,authorization(i)));return polygon.ABI.encodeFunctionData('transferWithAuthorization',[i.payer,i.recipient,i.amount_units,i.valid_after,i.valid_before,i.nonce,sig.v,sig.r,sig.s]);};
 const send=async(i,bytes)=>{const tx=await owner.sendTransaction({to:polygon.TOKEN,data:bytes||await data(i),gasLimit:300000});const receipt=await tx.wait();return{hash:tx.hash.toLowerCase(),receipt};};
 return{raw,provider,owner,recipient,payer,token,rpc,intent,data,send,authorization,close:()=>raw.disconnect()};
}
function fakeDb(intent){
 const state={intent:{...intent},proof:null,finishes:0,invoice:{id:intent.invoice_id,customer_id:randomUUID(),method_id:randomUUID(),total_cents:950,currency:'USD',kind:'goods',status:'accepted',expires_at:new Date(Date.now()+3600000).toISOString()},account:{provider:'polygon_usdc',mode:'live',account_tag:intent.account_tag}};
 const db={from(table){let many=false;const q={select(){return q},eq(){return q},in(){many=true;return q},order(){return q},limit(){return q},single:async()=>({data:table==='commerce_invoices'?state.invoice:state.account}),maybeSingle:async()=>({data:state.intent}),then(resolve){return Promise.resolve({data:many?[state.intent]:[]}).then(resolve)}};return q},async rpc(name,p){if(name==='commerce_note_polygon_usdc_submission'){if(p.p_hash){state.intent.candidate_tx_hash=p.p_hash;state.intent.status='submitted';}return{data:state.intent};}if(name==='commerce_finish_polygon_usdc_payment'){state.finishes++;state.proof=p.p_proof;state.intent.status='paid';return{data:{state:'paid',invoice_id:intent.invoice_id}};}if(name==='commerce_release_polygon_usdc_intent'){state.intent.status='expired';return{data:{confirmed_unpaid:true}};}throw Error(name);}};
 return{db,state};
}
test('Circle native USDC EIP-3009 execution and receipt verifier on disposable Polygon EVM',{skip:!ganache,timeout:60000},async t=>{
 const c=await chain();try{
  const i=await c.intent(),configuration=env(c.recipient),ready=await polygon.readiness(configuration,c.rpc);assert.equal(ready.ready,true);assert.equal(ready.operational,true);assert.equal(JSON.stringify(ready).includes('fixture.test'),false);assert.equal(JSON.stringify(ready).includes(c.recipient),false);
  const before=await c.token.balanceOf(c.recipient),data=await c.data(i),sent=await c.send(i,data);assert.equal(await c.token.balanceOf(c.recipient)-before,9500000n);
  assert.equal(await c.token.authorizationState(i.payer,i.nonce),true);
  const proof=await polygon.proofAt(configuration.POLYGON_USDC_RPC_URL,i,sent.hash,c.rpc);assert.equal(proof.amount_units,'9500000');assert.equal(proof.tx_hash,sent.hash);
  await t.test('actual contract rejects reuse of the same signed nonce',async()=>{await assert.rejects(c.send(i,data));assert.equal(await c.token.balanceOf(c.recipient)-before,9500000n);});
  await t.test('exact amount, destination, payer, nonce and validity are all bound',async()=>{const tx=await c.raw.request({method:'eth_getTransactionByHash',params:[sent.hash]});for(const patch of [{amount_units:'9500001'},{recipient:c.owner.address.toLowerCase()},{payer:c.recipient},{nonce:hash()},{valid_before:i.valid_before+1}])assert.throws(()=>polygon.decodeTransfer(tx,{...i,...patch}),/different order/);assert.throws(()=>polygon.decodeTransfer({...tx,to:c.recipient},i),/native USDC/);});
  await t.test('actual contract rejects wrong-chain signatures and expired authorizations',async()=>{const other=await c.intent();await assert.rejects(c.send(other,await c.data(other,{...polygon.DOMAIN,chainId:1})));const expired={...await c.intent(),valid_after:i.valid_after-3600,valid_before:i.valid_after};await assert.rejects(c.send(expired));});
  await t.test('a plain USDC transfer cannot claim an order',async()=>{const tx=await(await c.token.connect(await c.provider.getSigner(1)).transfer(c.recipient,9500000n)).wait();await assert.rejects(polygon.proofAt(configuration.POLYGON_USDC_RPC_URL,i,tx.hash.toLowerCase(),c.rpc),/exact order authorization/);});
  await t.test('unfinalized receipt remains pending',async()=>{const earlier=await c.raw.request({method:'eth_getBlockByNumber',params:['0x'+(BigInt(proof.block_number)-1n).toString(16),false]});const rpc=async(url,o)=>{const q=JSON.parse(o.body);return q.method==='eth_getBlockByNumber'&&q.params[0]==='finalized'?new Response(JSON.stringify({jsonrpc:'2.0',id:1,result:earlier})):c.rpc(url,o);};assert.equal((await polygon.proofAt(configuration.POLYGON_USDC_RPC_URL,i,sent.hash,rpc)).pending,true);});
  await t.test('receipt boundaries and excessive indices fail closed',async()=>{for(const change of [r=>{r.transactionIndex='0x7fffffff'},r=>{r.blockNumber='0x20000000000000'},r=>{r.logs[0].logIndex='0x20000000000000'},r=>{r.to=c.recipient},r=>{r.logs[0].blockNumber='0x0'}]){const rpc=async(url,o)=>{const res=await c.rpc(url,o),json=await res.json();if(JSON.parse(o.body).method==='eth_getTransactionReceipt')change(json.result);return new Response(JSON.stringify(json));};await assert.rejects(polygon.proofAt(configuration.POLYGON_USDC_RPC_URL,i,sent.hash,rpc));}});
  await t.test('replacement transaction is recovered from nonce history after browser closes',async()=>{const {db,state}=fakeDb({...i,candidate_tx_hash:hash(),status:'submitted'});const result=await polygon.reconcilePending(db,{env:configuration,fetchImpl:c.rpc});assert.equal(result.paid,1);assert.equal(state.proof.tx_hash,sent.hash);assert.equal(state.finishes,1);});
  await t.test('independent finality disagreement does not settle',async()=>{const {db,state}=fakeDb(i);const rpc=async(url,o)=>{if(url.includes('secondary')&&JSON.parse(o.body).method==='eth_getTransactionReceipt')return new Response(JSON.stringify({jsonrpc:'2.0',id:1,result:null}));return c.rpc(url,o);};const result=await polygon.confirm(db,state.invoice,state.account,polygon.configuration(configuration),{attempt_id:i.attempt_id,tx_hash:sent.hash},{id:state.invoice.customer_id},configuration,rpc,{dispatch:false});assert.equal(result.state,'pending');assert.equal(state.finishes,0);});
  await t.test('server creates one immutable EOA authorization and rejects amount tampering or contract wallets',async()=>{
   const fixture=await c.intent(),{db,state}=fakeDb(fixture),baseRpc=db.rpc;state.intent=null;
   db.rpc=async(name,p)=>{if(name==='commerce_create_polygon_usdc_intent'){state.intent={...p.p_intent,attempt_id:p.p_id,invoice_id:p.p_invoice,account_tag:p.p_account_tag,status:'open'};return{data:state.intent};}return baseRpc(name,p);};
   const body={attempt_id:randomUUID(),wallet_address:fixture.payer,confirm_amount_cents:950,confirm_currency:'USD',consent:true};
   await assert.rejects(polygon.start(db,state.invoice,state.account,polygon.configuration(configuration),{...body,confirm_amount_cents:949},{id:state.invoice.customer_id},configuration,c.rpc),/Review the current order/);
   await assert.rejects(polygon.start(db,state.invoice,state.account,polygon.configuration(configuration),{...body,wallet_address:polygon.TOKEN},{id:state.invoice.customer_id},configuration,c.rpc),/externally owned wallets/);
   const first=await polygon.start(db,state.invoice,state.account,polygon.configuration(configuration),body,{id:state.invoice.customer_id},configuration,c.rpc),second=await polygon.start(db,state.invoice,state.account,polygon.configuration(configuration),{...body,attempt_id:randomUUID()},{id:state.invoice.customer_id},configuration,c.rpc);
   assert.equal(first.intent.amount_units,'9500000');assert.equal(first.intent.nonce,second.intent.nonce);assert.equal(first.intent.attempt_id,second.intent.attempt_id);assert.match(first.intent.nonce,/^0x[0-9a-f]{64}$/);assert.equal(first.state,'awaiting_wallet');
  });
  await t.test('invoice ownership is required even for a public valid hash',async()=>{const {db,state}=fakeDb(i);await assert.rejects(polygon.confirm(db,state.invoice,state.account,polygon.configuration(configuration),{attempt_id:i.attempt_id,tx_hash:sent.hash},{id:randomUUID()},configuration,c.rpc),/another account/);assert.equal(state.finishes,0);});
  await t.test('a canceled order still verifies a subsequently presented receipt for review',async()=>{
   const {db,state}=fakeDb({...i,status:'expired'}),base=db.rpc;Object.assign(state.invoice,{status:'void',cancellation_status:'canceled',cancellation_requested_at:new Date().toISOString()});
   db.rpc=async(name,args)=>{if(name==='commerce_finish_polygon_usdc_payment'){state.proof=args.p_proof;return{data:{state:'review',invoice_id:i.invoice_id,cancellation_status:'review'}};}return base(name,args);};
   const result=await polygon.confirm(db,state.invoice,state.account,polygon.configuration(configuration),{attempt_id:i.attempt_id,tx_hash:sent.hash},{id:state.invoice.customer_id},configuration,c.rpc,{dispatch:false});
   assert.equal(result.state,'review');assert.equal(state.proof.tx_hash,sent.hash);
  });
  await t.test('requested cancellation exposes status without a reusable authorization and blocks new signing',async()=>{
   const {db,state}=fakeDb(await c.intent());Object.assign(state.invoice,{cancellation_status:'pending',cancellation_requested_at:new Date().toISOString()});
   const saved=await polygon.customerState(db,state.invoice,{id:state.invoice.customer_id},configuration);assert.equal(saved.state,'cancel_pending');assert.equal(saved.authorization,undefined);
   await assert.rejects(polygon.start(db,state.invoice,state.account,polygon.configuration(configuration),{attempt_id:state.intent.attempt_id,wallet_address:state.intent.payer,confirm_amount_cents:950,confirm_currency:'USD',consent:true},{id:state.invoice.customer_id},configuration,c.rpc),/Cancellation has been requested/);
   const pending=await polygon.confirm(db,state.invoice,state.account,polygon.configuration(configuration),{attempt_id:state.intent.attempt_id},{id:state.invoice.customer_id},configuration,c.rpc,{dispatch:false});assert.equal(pending.state,'cancel_pending');assert.equal(state.finishes,0);
  });
  await t.test('safe cancellation requires finalized expiry on both RPCs and an unused contract nonce',async()=>{
   const fresh=await c.intent(),unused=fakeDb(fresh);await assert.rejects(polygon.verifyUnpaid(unused.db,unused.state.invoice,configuration,c.rpc),/still valid/);
   const before=await c.raw.request({method:'eth_getBlockByNumber',params:['latest',false]});
   await c.raw.request({method:'evm_increaseTime',params:[2000]});await c.raw.request({method:'evm_mine',params:[]});
   const lagging=async(url,o)=>{const q=JSON.parse(o.body);return url.includes('secondary')&&q.method==='eth_getBlockByNumber'&&q.params[0]==='finalized'?new Response(JSON.stringify({jsonrpc:'2.0',id:q.id,result:before})):c.rpc(url,o);};
   await assert.rejects(polygon.verifyUnpaid(unused.db,unused.state.invoice,configuration,lagging),/still valid/);assert.equal(unused.state.intent.status,'open');
   assert.equal((await polygon.verifyUnpaid(unused.db,unused.state.invoice,configuration,c.rpc)).confirmed_unpaid,true);assert.equal(unused.state.intent.status,'expired');
   const used=fakeDb(i);await assert.rejects(polygon.verifyUnpaid(used.db,used.state.invoice,configuration,c.rpc),/used or canceled on-chain/);
   const queued=fakeDb(fresh),base=queued.db.rpc;Object.assign(queued.state.invoice,{cancellation_status:'pending',cancellation_requested_at:new Date().toISOString()});
   queued.db.rpc=async(name,p)=>{const result=await base(name,p);if(name==='commerce_release_polygon_usdc_intent'){queued.state.invoice.status='void';queued.state.invoice.cancellation_status='canceled';return{data:{...result.data,status:'void',cancellation_status:'canceled'}};}return result;};
   const completed=await polygon.reconcilePending(queued.db,{env:configuration,fetchImpl:c.rpc});assert.equal(completed.canceled,1);assert.equal(queued.state.invoice.status,'void');assert.equal(queued.state.finishes,0);
  });
 }finally{await c.close();}
});
test('native USDC requires independent endpoints and caps RPC streams before buffering',async()=>{
 const recipient='0x'+'a'.repeat(40),valid=env(recipient);assert.equal(polygon.configuration(valid).ready,true);assert.equal(polygon.configuration({...valid,POLYGON_USDC_SECONDARY_RPC_URL:''}).ready,false);assert.equal(polygon.configuration({...valid,POLYGON_USDC_SECONDARY_RPC_URL:valid.POLYGON_USDC_RPC_URL+'/other'}).ready,false);
 let canceled=0;const oversize=async()=>new Response(new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(131073));},cancel(){canceled++;}}));assert.equal((await polygon.readiness(valid,oversize)).operational,false);assert.ok(canceled>0);
 const empty=async()=>new Response('{}',{headers:{'content-length':'999999999'}});assert.equal((await polygon.readiness(valid,empty)).operational,false);
});
