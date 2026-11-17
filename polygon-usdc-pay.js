(function(){
 'use strict';
 const TOKEN='0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',CHAIN='0x89',ADDRESS=/^0x[0-9a-f]{40}$/i,HASH=/^0x[0-9a-f]{64}$/i;
 const DOMAIN_TYPES=[{name:'name',type:'string'},{name:'version',type:'string'},{name:'chainId',type:'uint256'},{name:'verifyingContract',type:'address'}];
 function word(value){const hex=BigInt(value).toString(16);if(hex.length>64||hex.startsWith('-'))throw Error('Invalid payment authorization.');return hex.padStart(64,'0');}
 function address(value){if(!ADDRESS.test(value))throw Error('Invalid payment address.');return value.slice(2).toLowerCase().padStart(64,'0');}
 function encode(authorization,signature){
  const m=authorization.message;if(!/^0x[0-9a-f]{130}$/i.test(signature)||!HASH.test(m.nonce)||authorization.domain.chainId!==137||authorization.domain.verifyingContract.toLowerCase()!==TOKEN)throw Error('Your wallet returned an unsupported authorization.');
  let v=parseInt(signature.slice(130,132),16);if(v<27)v+=27;if(v!==27&&v!==28)throw Error('Your wallet returned an unsupported signature.');
  return '0xe3ee160e'+address(m.from)+address(m.to)+word(m.value)+word(m.validAfter)+word(m.validBefore)+m.nonce.slice(2)+word(v)+signature.slice(2,66)+signature.slice(66,130);
 }
 async function mount({host,auth,invoice,amount,currency,ready,state}){
  let current=state||{state:'not_started'},wallet=null,provider=null,busy=false,disposed=false,poll=null,pollCount=0;
  const root=document.createElement('section');root.className='ap-form pure-usdc-payment';
  const heading=document.createElement('h2');heading.textContent='Pay with native USDC on Polygon';
  const details=document.createElement('p');details.textContent='Pay '+(amount/100).toFixed(2)+' USDC directly from your wallet. Use native USDC on Polygon, plus a little POL for your wallet’s network fee. Any applicable order discount is already included.';
  const summary=document.createElement('p');summary.className='ap-fine';summary.style.overflowWrap='anywhere';
  const status=document.createElement('p');status.className='native-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const connect=document.createElement('button');connect.type='button';connect.className='ap-button';connect.textContent='CONNECT WALLET';
  const pay=document.createElement('button');pay.type='button';pay.className='ap-button';pay.textContent='AUTHORIZE & PAY '+(amount/100).toFixed(2)+' USDC';pay.hidden=true;
  const check=document.createElement('button');check.type='button';check.className='ap-button ap-button-secondary';check.textContent='CHECK PAYMENT STATUS';
  const handoff=document.createElement('p');handoff.className='ap-fine';handoff.textContent='On mobile, open this saved order in the browser inside your compatible wallet, then sign in. On desktop, use a compatible wallet extension. This flow supports standard externally owned wallets.';
  const copy=document.createElement('button');copy.type='button';copy.className='ap-button ap-button-secondary';copy.textContent='COPY SAVED ORDER LINK';
  root.append(heading,details,summary,status,connect,pay,check,handoff,copy);host.replaceChildren(root);
  const key=()=>current.intent?'pure-usdc:'+invoice+':'+current.intent.attempt_id:null;
  function marker(value){try{const k=key();if(!k)return null;if(value===null)localStorage.removeItem(k);else if(value!==undefined)localStorage.setItem(k,value);return localStorage.getItem(k);}catch{return null;}}
  const uncertain=()=>current.state==='pending'||!!marker();
  function draw(text){
   if(disposed)return;const intent=current.intent,ended=['paid','review','expired'].includes(current.state),expired=intent&&Date.now()/1000>=Number(intent.valid_before);
   connect.hidden=ended||expired||!ready||uncertain()||!!wallet;connect.disabled=busy;
   pay.hidden=ended||!ready||uncertain()||!wallet||!intent||expired;pay.disabled=busy;
   check.hidden=!intent||current.state==='paid';check.disabled=busy;
   summary.textContent=intent?'Network: Polygon · Native USDC · Receiving wallet: '+intent.recipient:'';
   handoff.hidden=!!window.ethereum;copy.hidden=!!window.ethereum;
   status.textContent=text||(current.state==='paid'?'Payment confirmed. Your order is paid.':current.state==='review'?'Your transfer was received and needs order review. Please contact support with this saved order; do not send another payment.':current.state==='expired'||expired?'This authorization has expired. Check payment status before creating a new order.':uncertain()?'Checking your transfer on Polygon. Keep this order link; confirmation continues even if you close this page. Do not send a second payment.':!ready?'New wallet payments are currently unavailable for this order. You can still check a previously sent payment.':wallet?'Wallet connected. Review the amount, then authorize this order and confirm the transaction in your wallet.':'Connect your wallet to review the exact order authorization.');
  }
  async function api(body){
   const session=await auth.auth.getSession(),token=session.data?.session?.access_token;if(!token)throw Error('Sign in again to check or pay this saved order.');
   const r=await fetch('/api/checkout?native=customer&invoice='+encodeURIComponent(invoice),{method:body?'POST':'GET',cache:'no-store',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
   const data=await r.json();if(!r.ok)throw Error(data.error||'Payment confirmation is temporarily unavailable. Keep this saved order link.');return data;
  }
  function schedule(){clearTimeout(poll);if(disposed||!current.intent||['paid','review','expired'].includes(current.state)||pollCount>=18)return;poll=setTimeout(async()=>{pollCount++;await refresh();schedule();},10000);}
  async function refresh(){
   if(busy||disposed||!current.intent)return;busy=true;draw();
   try{const saved=marker(),hash=HASH.test(saved||'')?saved:current.intent.tx_hash;const result=await api({action:'confirm_crypto',invoice_id:invoice,attempt_id:current.intent.attempt_id,...(hash?{tx_hash:hash}:{})});current={...current,...result};if(['paid','review','expired'].includes(current.state))marker(null);draw();}
   catch(e){draw(e.message);}finally{busy=false;draw(status.textContent);}
  }
  async function selected(){
   const chain=await provider.request({method:'eth_chainId'});if(String(chain).toLowerCase()!==CHAIN)throw Error('Switch your wallet to Polygon before authorizing this order.');
   const accounts=await provider.request({method:'eth_accounts'});if(String(accounts?.[0]||'').toLowerCase()!==wallet){wallet=null;throw Error('The selected wallet changed. Reconnect the wallet selected for this order.');}
  }
  connect.onclick=async()=>{
   if(busy)return;busy=true;draw();
   try{
    provider=window.ethereum;if(!provider?.request)throw Error('Open this saved order in your wallet browser or use a desktop wallet extension.');
    const accounts=await provider.request({method:'eth_requestAccounts'});wallet=String(accounts?.[0]||'').toLowerCase();if(!ADDRESS.test(wallet))throw Error('Choose a compatible Polygon wallet.');
    if(String(await provider.request({method:'eth_chainId'})).toLowerCase()!==CHAIN)await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:CHAIN}]});
    await selected();
    current=await api({action:'pay',invoice_id:invoice,attempt_id:current.intent?.attempt_id||crypto.randomUUID(),wallet_address:wallet,confirm_amount_cents:amount,confirm_currency:currency,consent:true});
    if(current.intent&&current.intent.payer.toLowerCase()!==wallet)throw Error('Reconnect the original wallet for this saved payment.');
    draw();schedule();
   }catch(e){wallet=null;draw(e.code===4001?'Wallet connection was canceled. No payment was sent.':e.message);}finally{busy=false;draw(status.textContent);}
  };
  pay.onclick=async()=>{
   if(busy||uncertain()||!current.intent||Date.now()/1000>=current.intent.valid_before)return;busy=true;draw('Review the order authorization in your wallet.');let sending=false;
   try{
    await selected();
    const authorization=current.authorization,typed={...authorization,types:{EIP712Domain:DOMAIN_TYPES,...authorization.types}};
    if(authorization.message.from.toLowerCase()!==wallet||String(authorization.message.value)!==String(BigInt(amount)*10000n)||authorization.message.to.toLowerCase()!==current.intent.recipient.toLowerCase())throw Error('The wallet authorization does not match this order. Refresh payment status.');
    const signature=await provider.request({method:'eth_signTypedData_v4',params:[wallet,JSON.stringify(typed)]});
    const data=encode(authorization,signature);await selected();
    if(Date.now()/1000>=current.intent.valid_before)throw Error('This authorization expired before submission. Check payment status.');
    // Persist uncertainty before the wallet request: a lost response is not proof of failure.
    marker('broadcasting');sending=true;draw('Confirm the native USDC transfer and POL network fee in your wallet.');
    const hash=await provider.request({method:'eth_sendTransaction',params:[{from:wallet,to:TOKEN,value:'0x0',data}]});
    if(!HASH.test(hash||''))throw Error('Your wallet did not return a transaction reference. Check this saved order before doing anything else.');
    marker(hash.toLowerCase());current.state='pending';current.intent.tx_hash=hash.toLowerCase();draw();
   }catch(e){
    if(e.code===4001){if(sending)marker(null);draw(sending?'The transaction request was canceled. No new transfer was submitted by this page.':'Authorization was canceled. No payment was sent.');}
    else{if(sending)current.state='pending';draw(e.message);}
   }finally{busy=false;draw(status.textContent);if(uncertain()){await refresh();schedule();}}
  };
  check.onclick=async()=>{pollCount=0;await refresh();schedule();};
  copy.onclick=async()=>{try{await navigator.clipboard.writeText(location.origin+'/pay.html?invoice='+encodeURIComponent(invoice));draw('Saved order link copied. Open it in your wallet browser and sign in.');}catch{draw('Open '+location.origin+'/pay.html?invoice='+invoice+' in your wallet browser and sign in.');}};
  draw();if(current.intent)schedule();
  return{destroy(){disposed=true;clearTimeout(poll);root.remove();}};
 }
 window.PureUSDC={mount,encodeAuthorization:encode};
})();
