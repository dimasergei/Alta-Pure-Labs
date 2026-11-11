'use strict';
// Contract adapter only. No order submission is exposed or automatically enabled.
// Source: https://partners.lotuspeptide.com/api/documentation (2026-11-11).
const BASE='https://partners.lotuspeptide.com/api/v1';
function configuration(env=process.env){const key=env.LOTUS_PARTNER_API_KEY||'',match=/^ptr_(test|live)_[A-Za-z0-9_-]{43}$/.exec(key);return{configured:!!match,mode:match?.[1]||null};}
function linesFor(items,mapping){return items.map(item=>{const m=mapping[item.id+'|'+item.size];if(!m||!Number.isInteger(m.product)||m.product<1||!Number.isInteger(m.vials)||m.vials<1||!Number.isInteger(item.qty)||item.qty<1||item.qty%m.vials!==0)throw Error('An exact supplier product and pack mapping is required.');const quantity=item.qty/m.vials;if(quantity>100)throw Error('Supplier pack quantity exceeds the documented limit.');return{product:m.product,vials:m.vials,quantity};});}
function prepareOrder(order,mapping,quote){
 if(!['paid','processing'].includes(order.status)||order.kind!=='goods')throw Error('Only a verified paid goods order can be prepared.');
 if(!/^[a-f0-9-]{36}$/i.test(order.id))throw Error('Stable order ID required.');
 const a=order.request_data.address;if(a.country!=='US'||!/^\d{5}(?:-\d{4})?$/.test(a.postal_code)||!/^([A-Z]{2})$/.test(a.region))throw Error('Supplier requires a supported US address with a two-letter state and ZIP code.');
 if(!quote||!/^\d+\.\d{2}$/.test(quote.owed_total)||quote.problems?.length||quote.lines?.some(x=>x.problem))throw Error('A current available supplier quote is required.');
 return{reference:'ALTA-'+order.id,lines:linesFor(order.request_data.items,mapping),ship_to:{name:order.customer_name,line1:a.line1,line2:a.line2||'',city:a.city,state:a.region,zip:a.postal_code,email:order.customer_email},expected_owed:quote.owed_total};
}
function shipment(order){return order.status==='shipped'&&order.shipped_at&&order.tracking_number?{carrier:order.carrier,tracking_number:order.tracking_number,shipped_at:order.shipped_at}:null;}
async function request(path,body,{env=process.env,fetchImpl=fetch}={}){if(!configuration(env).configured)throw Error('Lotus partner API access is not configured.');if(!['/products','/pricing','/quote'].includes(path))throw Error('Only catalog and nonbinding quotes are enabled.');const r=await fetchImpl(BASE+path,{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+env.LOTUS_PARTNER_API_KEY,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});if(!r.ok)throw Object.assign(Error('Supplier request failed; check partner access and retry guidance.'),{status:r.status});return r.json();}
module.exports={configuration,linesFor,prepareOrder,shipment,request};
