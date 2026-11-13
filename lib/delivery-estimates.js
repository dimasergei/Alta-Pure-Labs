'use strict';
// Dispatch/carrier verified estimates only: do not invent dates or cutoffs.
const fields=['service','country','postalCode','rateCents','rateCurrency','cutoffAtISO','estimatedFromISO','estimatedToISO','timezone','confidence','source'];
function normalizeDeliveryEstimate(input){
 if(!input||typeof input!=='object')return null;
 const x=Object.fromEntries(fields.map(k=>[k,input[k]??null]));
 if(!x.source||typeof x.source!=='string'||!x.service||!x.country||!x.timezone)return null;
 if(!Number.isSafeInteger(x.rateCents)||x.rateCents<0||!/^[A-Z]{3}$/.test(x.rateCurrency||''))return null;
 for(const k of ['cutoffAtISO','estimatedFromISO','estimatedToISO']){
  if(x[k]!==null&&(!Number.isFinite(Date.parse(x[k]))))return null;
 }
 if(x.estimatedFromISO&&x.estimatedToISO&&Date.parse(x.estimatedFromISO)>Date.parse(x.estimatedToISO))return null;
 return Object.freeze(x);
}
function deliveryLabel(input){
 const x=normalizeDeliveryEstimate(input);
 if(!x?.estimatedFromISO||!x.estimatedToISO)return 'Estimated at dispatch';
 return 'Carrier estimate available';
}
module.exports={normalizeDeliveryEstimate,deliveryLabel};
