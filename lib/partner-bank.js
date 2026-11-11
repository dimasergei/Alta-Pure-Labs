'use strict';
const {randomBytes,createCipheriv,createDecipheriv}=require('node:crypto');
const fail=m=>{throw Object.assign(Error(m),{status:400});};
function key(env){if(!/^[a-f0-9]{64}$/i.test(env.PARTNER_BANK_ENCRYPTION_KEY||''))throw Object.assign(Error('Payout setup is temporarily unavailable.'),{status:503});return Buffer.from(env.PARTNER_BANK_ENCRYPTION_KEY,'hex');}
function normalize(b){
 const text=(n,min,max)=>{const v=String(b[n]||'').trim();if(v.length<min||v.length>max||/[\x00-\x1f]/.test(v))fail('Check the '+n.replaceAll('_',' ')+'.');return v;};
 const routing=text('routing_number',9,9),account=text('account_number',4,17);
 if(!/^\d{9}$/.test(routing)||/^0+$/.test(routing)||[...routing].reduce((n,d,i)=>n+Number(d)*[3,7,1][i%3],0)%10)fail('Enter a valid nine-digit US routing number.');
 if(!/^\d{4,17}$/.test(account)||account!==String(b.confirm_account||'').trim())fail('The account numbers must match.');
 if(!['checking','savings'].includes(b.account_type)||b.authorized!==true||b.country!=='US')fail('Choose a US bank account and authorize commission deposits.');
 return {holder:text('holder',2,120),bank_name:text('bank_name',2,120),account_type:b.account_type,country:'US',routing_number:routing,account_number:account,phone:text('phone',7,40),address:text('address',5,300),authorized_at:new Date().toISOString()};
}
function encrypt(value,owner,env=process.env){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(env),iv);cipher.setAAD(Buffer.from(owner));const ciphertext=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);return ['v1',iv.toString('base64'),cipher.getAuthTag().toString('base64'),ciphertext.toString('base64')].join('.');}
function decrypt(value,owner,env=process.env){const [v,iv,tag,data]=String(value).split('.');if(v!=='v1')throw Error('Unsupported bank record version.');const cipher=createDecipheriv('aes-256-gcm',key(env),Buffer.from(iv,'base64'));cipher.setAAD(Buffer.from(owner));cipher.setAuthTag(Buffer.from(tag,'base64'));return JSON.parse(Buffer.concat([cipher.update(Buffer.from(data,'base64')),cipher.final()]).toString('utf8'));}
function masked(value){return {bank_name:value.bank_name,account_type:value.account_type,country:value.country,last4:value.account_number.slice(-4)};}
module.exports={normalize,encrypt,decrypt,masked,key};
