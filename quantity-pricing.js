/* PURE quantity pricing in USD cents; checkout recomputes and verifies all savings. */
(function(){
'use strict';
const TIERS=Object.freeze([{min:10,bps:2000},{min:5,bps:1000},{min:2,bps:500},{min:1,bps:0}]);
function basisPoints(qty){if(!Number.isSafeInteger(qty)||qty<1||qty>100)throw Error('Invalid quantity');return TIERS.find(t=>qty>=t.min).bps;}
function discountCents(unitCents,qty){if(!Number.isSafeInteger(unitCents)||unitCents<1||unitCents>1000000)throw Error('Invalid price');return Math.round(unitCents*qty*basisPoints(qty)/10000);}
function totalCents(unitCents,qty){return unitCents*qty-discountCents(unitCents,qty);}
const api=Object.freeze({TIERS,basisPoints,discountCents,totalCents,VERSION:'pure-quantity-2026-11-v1'});
if(typeof module==='object'&&module.exports)module.exports=api;
if(typeof window!=='undefined')window.PureQuantityPricing=api;
})();
