'use strict';
const {createHmac,timingSafeEqual}=require('node:crypto');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function verify(headers,secret,now=Date.now()){
 if(typeof secret!=='string'||secret.length<32)return null;
 const timestamp=headers?.['x-commerce-job-time'],nonce=headers?.['x-commerce-job-nonce'],signature=headers?.['x-commerce-job-signature'];
 if(typeof timestamp!=='string'||!/^\d{10}$/.test(timestamp)||typeof nonce!=='string'||!UUID.test(nonce)||typeof signature!=='string'||! /^[a-f0-9]{64}$/.test(signature))return null;
 const issued=Number(timestamp)*1000;
 if(issued>now+5000||issued<now-60000)return null;
 const expected=createHmac('sha256',secret).update('invoice-email-retry\n'+timestamp+'\n'+nonce).digest();
 if(!timingSafeEqual(expected,Buffer.from(signature,'hex')))return null;
 return {nonce,issued_at:new Date(issued).toISOString()};
}
module.exports={verify};
