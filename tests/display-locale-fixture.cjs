'use strict';
// Deterministic display-only rates for program UI integration tests.
module.exports=function displayLocaleResponse(value){
 const url=new URL(value,'https://pure.example');
 if(url.pathname!=='/api/customer-config')return null;
 const supported=['USD','CAD','EUR','GBP','AUD'];
 let data;
 if(url.searchParams.get('display_locale')==='country')data={version:'display-locale-v1',base:'USD',country:'US',suggested_currency:'USD',supported_currencies:supported};
 else if(url.searchParams.get('display_locale')==='rates'){
  const now=Date.now();
  data={version:'display-fx-v1',base:'USD',provider:'frankfurter-ecb-v2',source:'European Central Bank',status:'fresh',supported_currencies:supported,
   fetched_at:new Date(now).toISOString(),expires_at:new Date(now+3600000).toISOString(),rate_date:new Date(now).toISOString().slice(0,10),
   rates:{USD:1,CAD:1.35,EUR:.9,GBP:.8,AUD:1.5}};
 }else return null;
 return{ok:true,status:200,json:async()=>data};
};
