'use strict';
const conversion = require('./conversion-pricing');
const {applyPromotions} = require('./checkout-promotions');
const {membershipDetails} = require('./membership-payment');

function unavailable() {
  return Object.assign(Error('Membership benefits could not be verified. Try again before paying.'),{status:503});
}

async function active(db, customerId, now = Date.now()) {
  const time = new Date(now).toISOString();
  const result = await db.from('commerce_memberships')
    .select('invoice_id,plan,starts_at,expires_at')
    .eq('customer_id',customerId).is('revoked_at',null).lte('starts_at',time).gt('expires_at',time);
  if (result.error) throw unavailable();
  const candidates=(result.data || []).filter(item=>['vip','elite'].includes(item.plan));
  if (!candidates.length) return null;
  const invoices=await db.from('commerce_invoices').select('id,customer_id,kind,plan,status,request_data')
    .in('id',candidates.map(item=>item.invoice_id)).eq('customer_id',customerId).eq('kind','membership').eq('status','paid');
  if (invoices.error) throw unavailable();
  const paid=new Map((invoices.data || []).filter(item=>item.customer_id===customerId && item.kind==='membership' && item.status==='paid').map(item=>[item.id,item]));
  return candidates.filter(item=>paid.get(item.invoice_id)?.plan===item.plan)
    .map(item=>({...item,billing_period:paid.get(item.invoice_id).request_data?.billing_period || null}))
    .sort((a,b)=>conversion.planFor(b).discount_bps-conversion.planFor(a).discount_bps || Date.parse(b.expires_at)-Date.parse(a.expires_at))[0] || null;
}

async function pending(db,customerId,now=Date.now()) {
  const result=await db.from('commerce_invoices')
    .select('id,kind,plan,status,currency,method_id,checkout_version,request_data,pricing,subtotal_cents,discount_cents,shipping_cents,tax_cents,total_cents,points_redeemed,credit_redeemed_cents,earned_points,membership_invoice_id,expires_at')
    .eq('customer_id',customerId).eq('kind','membership').in('status',['requested','issued','accepted'])
    .order('created_at',{ascending:false}).limit(10);
  if(result.error) throw unavailable();
  for(const invoice of result.data || []) {
    const detail=membershipDetails(invoice);
    if(invoice.kind!=='membership' || !['requested','issued','accepted'].includes(invoice.status)) continue;
    return {invoice_id:invoice.id,plan:invoice.plan,name:conversion.planFor({plan:invoice.plan}).name,
      billing_period:detail?.period || invoice.request_data?.billing_period || null,status:invoice.status,
      currency:invoice.currency,total_cents:invoice.total_cents,expires_at:invoice.expires_at,
      expired:!Number.isFinite(Date.parse(invoice.expires_at)) || Date.parse(invoice.expires_at)<=now,requires_review:!detail};
  }
  return null;
}

function publicMembership(membership) {
  if (!membership) return null;
  const plan=conversion.planFor(membership);
  return {...membership,name:plan.name,status:'active',billing_mode:'prepaid',automatic_renewal:false,
    benefits:{...plan},actions:[]};
}

function apply(pricing,membership,coupon='') {
  applyPromotions(pricing,'goods',coupon);
  const plan=conversion.planFor(membership),rate=plan.discount_bps || 0;
  pricing.membership_plan=membership?.plan || null;
  pricing.membership_name=membership ? plan.name : null;
  pricing.membership_discount_bps=rate;
  pricing.membership_discount_cents=0;
  pricing.membership_benefits={free_shipping:!!plan.free_shipping,priority_fulfillment:!!plan.priority_fulfillment,free_bac_water_3ml:!!plan.free_bac_water_3ml};
  pricing.lines=pricing.lines.map(line=>({...line,membership_discount_cents:0}));
  const savings=Math.round(pricing.subtotal_cents*rate/10000);
  // A membership and a coupon compete for the same merchandise saving. The
  // payment-method incentive is applied separately after this best-price choice.
  if (!membership || savings <= pricing.coupon_discount_cents) return pricing;
  const discounts=pricing.lines.map(line=>Math.floor(line.gross_cents*rate/10000));
  const pennies=savings-discounts.reduce((sum,amount)=>sum+amount,0);
  const ranked=pricing.lines.map((line,index)=>({index,remainder:line.gross_cents*rate%10000}))
    .sort((a,b)=>b.remainder-a.remainder || a.index-b.index);
  for(let index=0;index<pennies;index++) discounts[ranked[index].index]++;
  pricing.lines=pricing.lines.map((line,index)=>({...line,discount_cents:discounts[index],discount_bps:rate,
    discount_reason:'membership_'+membership.plan,membership_discount_cents:discounts[index],coupon_discount_cents:0,
    line_total_cents:line.gross_cents-discounts[index]}));
  pricing.discount_cents=savings;pricing.membership_discount_cents=savings;pricing.coupon_discount_cents=0;
  return pricing;
}

function deliveryQuote(quote,membership) {
  const plan=conversion.planFor(membership);
  const free=!!plan.free_shipping && quote.country==='US' && ['standard','express'].includes(quote.selection.shipping);
  const extras=quote.extras.map(extra=>extra.id==='priority'&&plan.priority_fulfillment?{...extra,amount_cents:0,included_by_membership:true}:extra);
  const extrasCents=extras.reduce((sum,extra)=>sum+extra.amount_cents,0),shipping=free?0:quote.shipping_cents;
  return {...quote,membership_shipping:free,shipping_cents:shipping,extras,extras_cents:extrasCents,total_cents:shipping+extrasCents};
}

module.exports={active,pending,publicMembership,apply,deliveryQuote};
