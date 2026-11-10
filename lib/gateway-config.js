'use strict';
const {createHash}=require('node:crypto');
const error=(status,message)=>Object.assign(Error(message),{status});
function configuration(provider,env=process.env){
 const prefix=provider==='nmi'?'NMI':'PAYERURL';if(!['nmi','payerurl'].includes(provider))throw error(400,'Unknown gateway.');
 const mode=env[prefix+'_MODE']||'disabled',missing=[];
 const required=provider==='nmi'?['NMI_API_KEY','NMI_TOKENIZATION_KEY','NMI_WEBHOOK_KEY','NMI_MERCHANT_ID']:['PAYERURL_PUBLIC_KEY','PAYERURL_SECRET_KEY','PAYERURL_CHECKOUT_HOST','PAYERURL_CALLBACK_UNIT'];
 for(const key of required)if(!env[key])missing.push(key);
 const currencies=(env[prefix+'_CURRENCIES']||'').split(',').filter(x=>['USD','CAD'].includes(x));
 if(!currencies.length)missing.push(prefix+'_CURRENCIES');
 if(provider==='payerurl'&&env.PAYERURL_PROTOCOL!=='node-form-v1')missing.push('PAYERURL_PROTOCOL=node-form-v1 (provider-confirmed)');
 if(provider==='payerurl'&&!['major','minor'].includes(env.PAYERURL_CALLBACK_UNIT))missing.push('PAYERURL_CALLBACK_UNIT=major|minor (provider-confirmed)');
 if(provider==='payerurl'&&env.PAYERURL_CHECKOUT_HOST&&!/^(?:[a-z0-9-]+\.)*payerurl\.com$/.test(env.PAYERURL_CHECKOUT_HOST))missing.push('valid PAYERURL_CHECKOUT_HOST');
 const production=env.VERCEL_ENV==='production';
 const enabled=env[prefix+'_ENABLED']==='true'&&['live','sandbox'].includes(mode)&&!(production&&mode!=='live')&&!(provider==='payerurl'&&mode!=='live');
 const identity=provider==='nmi'?env.NMI_MERCHANT_ID:env.PAYERURL_PUBLIC_KEY;
 return {provider,mode,ready:enabled&&missing.length===0,enabled,missing,currencies,
 account_tag:identity?createHash('sha256').update(provider+':'+mode+':'+identity).digest('hex'):null,
 tokenization_key:provider==='nmi'?env.NMI_TOKENIZATION_KEY:undefined,
 three_ds:provider==='nmi'&&env.NMI_3DS_ENABLED==='true',
 wallets:{apple:env.NMI_APPLE_PAY_ENABLED==='true',google:env.NMI_GOOGLE_PAY_ENABLED==='true'}};
}
function assertReady(provider,env){const c=configuration(provider,env);if(!c.ready)throw error(503,'This gateway is not activated. Merchant credentials and verification are still required.');return c;}
function publicStatus(env){return ['nmi','payerurl'].map(p=>{const c=configuration(p,env);return{provider:p,mode:c.mode,ready:c.ready,enabled:c.enabled,missing:c.missing,currencies:c.currencies,three_ds:c.three_ds,wallets:c.wallets};});}
module.exports={configuration,assertReady,publicStatus,error};
