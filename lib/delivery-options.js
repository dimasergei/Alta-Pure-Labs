'use strict';
const defaults=require('../config/delivery-options.json');
const zones=require('../config/shipping-zones.json');
const fail=m=>{throw Object.assign(Error(m),{status:400});};
function selection(value){if(value===undefined)return{shipping:'standard',extras:[]};if(!value||typeof value!=='object'||!['standard','express','next_day'].includes(value.shipping)||!Array.isArray(value.extras)||value.extras.length>3||new Set(value.extras).size!==value.extras.length||value.extras.some(x=>!['priority','cold_chain','protection'].includes(x)))fail('Review the delivery options.');return{shipping:value.shipping,extras:[...value.extras].sort()};}
function countryRates(country){
 if(typeof country!=='string'||!/^[A-Z]{2}$/.test(country))fail('Choose a valid shipping country.');
 if(zones.unavailable_countries.includes(country))fail('Shipping is not available for the selected country.');
 return zones[country]||zones.OTHER;
}
function price(value,free,options=defaults,country='US'){const s=selection(value),rows=[s.shipping,...s.extras].map(id=>options.find(x=>x.id===id));if(rows.some(x=>!x?.enabled))fail('A selected delivery option is unavailable.');const rates=countryRates(country);
 if(!Number.isSafeInteger(rates[s.shipping]))fail('The shipping service is unavailable for this destination.');
 const shipping=free&&country==='US'&&s.shipping==='standard'?0:rates[s.shipping];const extras=rows.slice(1).map(x=>({id:x.id,label:x.label,amount_cents:x.price_cents}));return{selection:s,shipping_cents:shipping,country,rate_version:zones.version,extras,extras_cents:extras.reduce((n,x)=>n+x.amount_cents,0),total_cents:shipping+extras.reduce((n,x)=>n+x.amount_cents,0)};}
async function load(db){const r=await db.from('commerce_delivery_options').select('id,kind,label,price_cents,enabled,description');if(r.error)throw Object.assign(Error('Delivery options are unavailable.'),{status:503});return r.data;}
module.exports={defaults,selection,price,load,countryRates,zones};
