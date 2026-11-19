/* PURE quantity savings: regular cart uses ordinary unit prices.
   Bulk Orders apply one rate to the TOTAL quantity across product sizes. */
(function(){
'use strict';
const TIERS=Object.freeze([{min:50,bps:5000},{min:10,bps:2000},{min:1,bps:0}]);
function bulkRate(units){if(!Number.isSafeInteger(units)||units<0||units>6000)throw Error('Invalid bulk quantity');return units>=50?5000:units>=10?2000:0;}
function bulkDiscountCents(grossCents,units){if(!Number.isSafeInteger(grossCents)||grossCents<0||grossCents>100000000)throw Error('Invalid bulk amount');return Math.round(grossCents*bulkRate(units)/10000);}
function basisPoints(qty){if(!Number.isSafeInteger(qty)||qty<1||qty>100)throw Error('Invalid regular quantity');return 0;}
function discountCents(unitCents,qty){if(!Number.isSafeInteger(unitCents)||unitCents<1||unitCents>1000000||!Number.isSafeInteger(qty)||qty<1||qty>100)throw Error('Invalid product price or quantity');return 0;}
function totalCents(unitCents,qty){return unitCents*qty-discountCents(unitCents,qty);}
const api=Object.freeze({TIERS,bulkRate,bulkDiscountCents,basisPoints,discountCents,totalCents,VERSION:'pure-bulk-2026-11-v1'});
if(typeof module==='object'&&module.exports)module.exports=api;
if(typeof window!=='undefined')window.PureQuantityPricing=api;
})();
