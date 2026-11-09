'use strict';

/**
 * Offline simulation of an append-only reward/credit ledger.
 * No account, checkout, payout, refund or balance is changed by this module.
 */
const KINDS=Object.freeze(['earn','redeem','reverse','expire']);
const ID=/^[a-z0-9][a-z0-9-]{1,119}$/;
function validateEvent(e){
 return !!e&&typeof e==='object'&&ID.test(e.id||'')&&ID.test(e.account_id||'')&&
  KINDS.includes(e.kind)&&Number.isSafeInteger(e.units)&&e.units>0&&e.units<=100000000&&
  typeof e.currency==='string'&&['POINTS','USD_CENTS'].includes(e.currency)&&
  typeof e.reference==='string'&&e.reference.length>=2&&e.reference.length<=180&&
  typeof e.created_at==='string'&&Number.isFinite(Date.parse(e.created_at))&&
  (e.kind!=='reverse'||ID.test(e.reverses_id||''));
}
function replay(events,accountId,currency){
 if(!Array.isArray(events)||!ID.test(accountId||'')||!['POINTS','USD_CENTS'].includes(currency))
  return {valid:false,reason:'INVALID_INPUT'};
 let balance=0;
 const ids=new Set(),eventsById=new Map(),reversed=new Set();
 for(const e of events){
  if(!validateEvent(e)||ids.has(e.id))return {valid:false,reason:'INVALID_OR_DUPLICATE_EVENT'};
  ids.add(e.id);
  if(e.account_id!==accountId||e.currency!==currency)continue;
  let delta=0;
  if(e.kind==='earn')delta=e.units;
  if(e.kind==='redeem'||e.kind==='expire')delta=-e.units;
  if(e.kind==='reverse'){
   const original=eventsById.get(e.reverses_id);
   if(!original||reversed.has(e.reverses_id)||original.kind==='reverse'||original.units!==e.units)
    return {valid:false,reason:'INVALID_REVERSAL'};
   delta=(original.kind==='earn'?-1:1)*e.units;
   reversed.add(e.reverses_id);
  }
  if(!Number.isSafeInteger(balance+delta)||balance+delta<0)return {valid:false,reason:'NEGATIVE_OR_OVERFLOW'};
  balance+=delta;
  eventsById.set(e.id,e);
 }
 return {valid:true,account_id:accountId,currency,balance,spendable:false};
}
module.exports={KINDS,validateEvent,replay};
