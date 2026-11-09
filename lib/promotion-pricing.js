'use strict';

/**
 * Pure pricing simulation; does not enable discounts or create transactions.
 * Only explicitly approved, currently active rules can affect a quote.
 */
const TYPES=Object.freeze(['percent','fixed','buy_x_get_y']);
function validMoney(n){return Number.isSafeInteger(n)&&n>=0&&n<=999999999;}
function validCart(lines){
 if(!Array.isArray(lines)||!lines.length||lines.length>100)return false;
 const seen=new Set();
 return lines.every(x=>{
  if(!x||typeof x.sku_key!=='string'||!/^[a-z0-9-]+$/.test(x.sku_key)||
   !validMoney(x.unit_price_cents)||x.unit_price_cents===0||
   !Number.isSafeInteger(x.quantity)||x.quantity<1||x.quantity>100||
   seen.has(x.sku_key))return false;
  seen.add(x.sku_key);return true;
 });
}
function active(rule,now){
 if(!rule||rule.approved!==true||rule.enabled!==true||
    !TYPES.includes(rule.type)||typeof rule.id!=='string'||
    !/^[a-z0-9-]+$/.test(rule.id)||typeof rule.starts_at!=='string'||
    typeof rule.ends_at!=='string'||!Number.isFinite(Date.parse(rule.starts_at))||
    !Number.isFinite(Date.parse(rule.ends_at)))return false;
 return new Date(rule.starts_at)<=now&&now<new Date(rule.ends_at);
}
function discountFor(rule,lines,subtotal){
 if(rule.type==='percent'){
  if(!Number.isSafeInteger(rule.percent_bps)||rule.percent_bps<0||rule.percent_bps>10000)return null;
  return Math.floor(subtotal*rule.percent_bps/10000);
 }
 if(rule.type==='fixed'){
  if(!validMoney(rule.amount_cents))return null;
  return Math.min(subtotal,rule.amount_cents);
 }
 if(rule.type==='buy_x_get_y'){
  if(typeof rule.sku_key!=='string'||!Number.isSafeInteger(rule.buy_qty)||rule.buy_qty<1||
    !Number.isSafeInteger(rule.free_qty)||rule.free_qty<1||rule.free_qty>rule.buy_qty)return null;
  const line=lines.find(x=>x.sku_key===rule.sku_key);
  if(!line)return 0;
  const group=rule.buy_qty+rule.free_qty;
  const free=Math.floor(line.quantity/group)*rule.free_qty+
    Math.max(0,line.quantity%group-rule.buy_qty);
  return Math.min(subtotal,free*line.unit_price_cents);
 }
 return null;
}
function quoteCart(lines,rules=[],now=new Date()){
 if(!validCart(lines)||!Array.isArray(rules)||!(now instanceof Date)||!Number.isFinite(now.getTime()))return {valid:false,reason:'INVALID_INPUT'};
 const subtotal=lines.reduce((n,x)=>n+x.unit_price_cents*x.quantity,0);
 if(!Number.isSafeInteger(subtotal)||subtotal>999999999)return {valid:false,reason:'TOTAL_LIMIT'};
 const eligible=rules.filter(r=>active(r,now)).map(r=>({rule:r,discount:discountFor(r,lines,subtotal)}))
  .filter(x=>x.discount!==null&&x.discount>=0);
 // Deliberately no stacking: only the highest approved discount applies.
 eligible.sort((a,b)=>b.discount-a.discount||a.rule.id.localeCompare(b.rule.id));
 const chosen=eligible[0];
 const discount=chosen?.discount||0;
 return {valid:true,currency:'USD',subtotal_cents:subtotal,discount_cents:discount,
   total_before_shipping_tax_cents:subtotal-discount,applied_rule_id:chosen?.rule.id||null,
   checkout_allowed:false};
}
module.exports={TYPES,validCart,active,discountFor,quoteCart};
