'use strict';
// Rates alone do not establish taxability, nexus or importer responsibility.
// Each final invoice requires an explicit, documented review of those facts.
const fail=message=>{throw Object.assign(Error(message),{status:400});};
const text=(v,min,max,label)=>typeof v==='string'&&v.trim().length>=min&&v.trim().length<=max&&!/[\x00-\x1f]/.test(v)?v.trim():fail('Complete '+label+'.');
const int=(v,min,max,label)=>Number.isSafeInteger(v)&&v>=min&&v<=max?v:fail('Check '+label+'.');
const federalRates={AB:50000,BC:50000,MB:50000,NB:150000,NL:150000,NS:140000,NT:50000,NU:50000,ON:130000,PE:150000,QC:50000,SK:50000,YT:50000};
function review(invoice,pricing,body,now=new Date()){
 const source=body.delivery_tax;if(!source||source.confirmed!==true)fail('Complete the delivery and tax review before issuing an invoice.');
 const destination={country:text(source.destination_country,2,2,'tax destination country').toUpperCase(),region:text(source.destination_region,1,80,'tax destination state / province')};
 if(!/^[A-Z]{2}$/.test(destination.country))fail('Use a two-letter destination country.');
 if(invoice.kind==='goods'&&(destination.country!==invoice.request_data.address?.country||destination.region.toUpperCase()!==String(invoice.request_data.address?.region).toUpperCase()))fail('Tax destination must match the requested delivery address.');
 const seller=text(source.seller_name,2,180,'legal seller name');
 const basis=text(source.tax_basis,12,1200,'tax treatment and jurisdiction review');
 const shipping=int(body.shipping_cents,0,10000000,'shipping amount');
 const net=pricing.subtotal_cents-pricing.discount_cents;
 const out={version:1,seller_name:seller,destination,reviewed_at:now.toISOString(),tax_basis:basis,taxes:[]};
 if(invoice.kind==='goods'){
  const d=source.delivery||{},origin=text(d.origin_country,2,2,'dispatch country').toUpperCase();if(!/^[A-Z]{2}$/.test(origin))fail('Use a two-letter dispatch country.');
  const min=int(d.transit_min_days,1,90,'minimum transit days'),max=int(d.transit_max_days,min,120,'maximum transit days');
  const handling=int(d.handling_max_days,0,60,'maximum handling days');
  const duties=d.duties;if(!['domestic','seller','customer'].includes(duties)||((origin===destination.country)!==(duties==='domestic')))fail('Specify who handles import charges for this route.');
  const expiry=Date.parse(d.quote_expires_at);if(!Number.isFinite(expiry)||expiry<=now.getTime())fail('Shipping quote is missing or expired.');
  out.delivery={origin_country:origin,origin_region:text(d.origin_region,2,80,'dispatch state / province'),carrier:text(d.carrier,2,100,'quoted carrier'),service:text(d.service,2,100,'quoted shipping service'),handling_max_days:handling,transit_min_days:min,transit_max_days:max,duties,quote_expires_at:new Date(expiry).toISOString(),amount_cents:shipping};
  out.private_review={shipping_quote_reference:text(d.quote_reference,4,400,'supplier/carrier quote reference'),route_review:text(d.route_review,12,600,'destination, carrier and product eligibility review')};
  if(duties!=='domestic')out.delivery.importer=text(d.importer,2,180,'importer of record');
 }else if(shipping!==0)fail('Membership has no delivery charge.');
 const mode=source.tax_mode;if(!['canada_taxable_goods','reviewed'].includes(mode))fail('Choose the reviewed tax treatment.');out.tax_mode=mode;
 if(mode==='canada_taxable_goods'){
  if(invoice.kind!=='goods'||destination.country!=='CA')fail('Canadian goods rates require goods delivered in Canada.');
  const region=destination.region.toUpperCase();if(!Object.hasOwn(federalRates,region))fail('Use a Canadian province or territory code for automatic GST/HST.');
  if(source.canada_supply_confirmed!==true)fail('Confirm a taxable supply delivered in Canada and the import tax treatment.');
  const registration=text(source.gst_hst_number,15,15,'GST/HST registration number').toUpperCase();if(!/^\d{9}RT\d{4}$/.test(registration))fail('Use the full GST/HST account number (9 digits, RT and 4 digits).');
  const rate=federalRates[region],base=net+(source.shipping_taxable===true?shipping:0);
  if(typeof source.shipping_taxable!=='boolean')fail('Confirm whether GST/HST applies to the delivery charge.');
  out.taxes.push({label:rate===50000?'GST':'HST',rate_ppm:rate,taxable_cents:base,amount_cents:Math.round(base*rate/1000000),registration_number:registration});
 }
 // Explicit additional tax lines support reviewed provincial/state/local assessments.
 // No address-only guessing of US nexus, PST/QST registration, exemptions or import VAT.
 if(!Array.isArray(source.components)||source.components.length>5)fail('Supply the reviewed tax lines (an empty list requires a documented no-collection basis).');
 for(const c of source.components){
  const label=text(c.label,2,60,'tax label'),rate=int(c.rate_ppm,1,300000,'tax rate'),base=int(c.taxable_cents,1,net+shipping,'taxable amount');
  if(mode==='canada_taxable_goods'&&/\b(GST|HST)\b/i.test(label))fail('GST/HST is already calculated; do not add it twice.');
  const registration=text(c.registration_number,2,80,'tax registration / collection authority');
  out.taxes.push({label,rate_ppm:rate,taxable_cents:base,amount_cents:Math.round(base*rate/1000000),registration_number:registration});
 }
 if(source.jurisdictions_reviewed!==true)fail('Review destination sales taxes, including state/local taxes or PST/QST where applicable.');
 out.tax_cents=out.taxes.reduce((n,t)=>n+t.amount_cents,0);
 if(out.tax_cents>10000000)fail('Tax exceeds the supported invoice amount.');
 if(destination.country==='CA'&&out.tax_cents>0&&pricing.currency==='USD'){
  const f=source.reporting_fx||{};out.reporting_fx={cad_per_usd_ppm:int(f.cad_per_usd_ppm,100000,10000000,'CAD tax reporting exchange rate'),date:text(f.date,10,10,'tax exchange-rate date'),source:text(f.source,4,200,'tax exchange-rate source')};
  if(!/^\d{4}-\d{2}-\d{2}$/.test(out.reporting_fx.date)||!Number.isFinite(Date.parse(out.reporting_fx.date))||new Date(out.reporting_fx.date).toISOString().slice(0,10)!==out.reporting_fx.date||Date.parse(out.reporting_fx.date)>now.getTime())fail('Use a valid tax reporting exchange-rate date.');
  out.reporting_fx.tax_cad_cents=Math.round(out.tax_cents*out.reporting_fx.cad_per_usd_ppm/1000000);
 }
 return out;
}
function publicPricing(pricing){if(!pricing)return pricing;const out={...pricing};if(out.delivery_tax){out.delivery_tax={...out.delivery_tax};delete out.delivery_tax.private_review;}return out;}
module.exports={review,publicPricing,federalRates};
