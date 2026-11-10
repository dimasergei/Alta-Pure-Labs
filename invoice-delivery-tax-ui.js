(() => {
 'use strict';
 const form=document.getElementById('pay-issue-form');if(!form)return;
 const field=(label,name,type='text',extra='')=>`<label>${label}<input name="${name}" type="${type}" ${extra}></label>`;
 const section=document.createElement('section');section.className='ops-card';section.id='invoice-delivery-tax';
 section.innerHTML=`<h3>Delivery and tax review</h3><p>Use the supplier’s actual shipping quote. Confirm the tax treatment for the delivery terms and destination before issuing a payable invoice.</p>
 ${field('Legal seller','dt_seller','text','maxlength="180" value="1001517614 ONTARIO INC."')}
 <div class="ops-two">${field('Tax destination country code','dt_country','text','maxlength="2"')}${field('Tax destination state / province','dt_region','text','maxlength="80"')}</div>
 <fieldset id="dt-delivery"><legend>Quoted delivery</legend>
 <label>Supplier planning estimate<select name="dt_supplier"><option value="">Loading supplier profiles…</option></select></label><button type="button" id="dt-apply-supplier" disabled>Use supplier estimate</button><p id="dt-supplier-note" role="status">Estimates do not confirm a carrier, rate, available lot or destination eligibility. Confirm those details before issuing the invoice.</p>
 <div class="ops-two">${field('Dispatch country code','dt_origin','text','maxlength="2" value="US"')}${field('Dispatch state / province','dt_origin_region','text','maxlength="80"')}</div>
 <div class="ops-two">${field('Carrier','dt_carrier','text','maxlength="100"')}${field('Service','dt_service','text','maxlength="100"')}</div>
 ${field('Supplier/carrier quote reference (private)','dt_quote','text','maxlength="400"')}${field('Quote valid until','dt_expiry','datetime-local')}
 <div class="ops-two">${field('Handling: maximum business days','dt_handling','number','min="0" max="60"')}${field('Transit: minimum business days','dt_min','number','min="1" max="90"')}${field('Transit: maximum business days','dt_max','number','min="1" max="120"')}</div>
 <label>Import duties, taxes and brokerage<select name="dt_duties"><option value="">Choose the agreed delivery terms</option><option value="domestic">Domestic shipment — no import leg</option><option value="seller">Seller handles import charges</option><option value="customer">Customer handles import charges</option></select></label>
 ${field('Importer of record (cross-border shipments)','dt_importer','text','maxlength="180"')}
 <label>Product, destination and carrier review (private)<textarea name="dt_route" maxlength="600" rows="2" placeholder="Reference the supplier route confirmation and exact product eligibility."></textarea></label></fieldset>
 <label>Tax treatment<select name="dt_mode"><option value="">Choose after reviewing the supply</option><option value="canada_taxable_goods">Taxable goods delivered in Canada — calculate GST/HST</option><option value="reviewed">Reviewed treatment — enter applicable tax lines, or explain no collection</option></select></label>
 <p>US dispatch does not automatically mean tax-free. Review US state/local obligations; Canadian imports also need an importer and place-of-supply determination. Membership passes require their own tax review.</p>
 <section id="dt-canada">${field('GST/HST account number','dt_gst','text','maxlength="15" placeholder="123456789RT0001"')}<label><input type="checkbox" name="dt_ca_confirmed"> These are taxable goods supplied in Canada; import tax treatment has been reviewed.</label><label>Does GST/HST apply to the delivery charge?<select name="dt_shipping_tax"><option value="">Select</option><option value="yes">Yes</option><option value="no">No — explain the basis below</option></select></label><p>Current GST/HST rates: ON 13%; NS 14%; NB/NL/PE 15%; other provinces/territories 5% GST. Review PST/QST separately.</p></section>
 <h4>Additional / reviewed taxes</h4><p>Enter only taxes you are required or authorized to collect. Leave unused rows blank. Amounts use the invoice currency; rates are percentages.</p>
 ${[0,1,2].map(i=>`<div class="ops-two">${field('Tax name',`dt_label_${i}`,'text','maxlength="60" placeholder="e.g. State sales tax / QST"')}${field('Rate (%)',`dt_rate_${i}`,'number','min="0.0001" max="30" step="0.0001"')}${field('Taxable amount',`dt_base_${i}`,'number','min="0.01" step="0.01"')}${field('Registration / collection authority',`dt_reg_${i}`,'text','maxlength="80"')}</div>`).join('')}
 <label>Tax treatment explanation (shown on invoice)<textarea name="dt_basis" minlength="12" maxlength="1200" rows="3" placeholder="Explain place of supply, each tax collected, or why no sales tax is collected. Include provincial/state/local review and any customer import charges."></textarea></label>
 <details><summary>USD invoices with Canadian tax: reporting conversion</summary><p>This is the documented CAD reporting rate, separate from the customer’s invoice currency conversion.</p>${field('CAD per USD','dt_fx','number','min="0.1" max="10" step="0.000001"')}${field('Exchange-rate date','dt_fx_date','date')}${field('Source / approved conversion method','dt_fx_source','text','maxlength="200"')}</details>
 <label><input type="checkbox" name="dt_jurisdictions"> I reviewed all applicable destination taxes and collection obligations, including PST/QST or US state/local taxes.</label>
 <label><input type="checkbox" name="dt_confirmed"> The shipping quote and tax treatment are complete for this exact invoice.</label>`;
 form.querySelector('[name="review_note"]').closest('label').before(section);
 form.elements.tax.readOnly=true;form.elements.tax.value='';form.elements.tax.placeholder='Calculated on preview';
 let suppliers=[];
 fetch('/data/supplier-references.json').then(r=>{if(!r.ok)throw Error();return r.json();}).then(data=>{
  suppliers=data.suppliers;const select=form.elements.dt_supplier;select.replaceChildren(new Option('Choose a supplier',''));
  for(const supplier of suppliers)select.add(new Option(supplier.name,supplier.id));document.getElementById('dt-apply-supplier').disabled=false;
 }).catch(()=>{document.getElementById('dt-supplier-note').textContent='Supplier profiles unavailable. Enter the actual supplier quote manually.';});
 document.getElementById('dt-apply-supplier').onclick=()=>{
  const supplier=suppliers.find(s=>s.id===form.elements.dt_supplier.value);if(!supplier)return;
  const country=form.elements.dt_country.value.trim().toUpperCase(),transit=country==='US'?supplier.domestic_transit:country?supplier.international_transit:null;
  const values={dt_origin:supplier.origin_country,dt_origin_region:supplier.origin_region,dt_handling:supplier.handling_max_days,dt_min:transit?.min??'',dt_max:transit?.max??'',dt_carrier:'',dt_service:'',dt_quote:'',dt_expiry:'',dt_route:'',dt_duties:'',dt_importer:'',shipping:''};
  for(const [key,value]of Object.entries(values))form.elements[key].value=value;
  form.elements.dt_confirmed.checked=false;
  document.getElementById('dt-supplier-note').textContent=supplier.name+': '+supplier.handling_note+' '+supplier.service_note+' Source: '+supplier.shipping_source+' Confirm or replace these estimates using the actual quote. Previous shipping quote cleared.';
  form.dispatchEvent(new Event('input',{bubbles:true}));
 };
 function changed(){document.getElementById('dt-canada').hidden=form.elements.dt_mode.value!=='canada_taxable_goods';}
 form.elements.dt_mode.addEventListener('change',changed);changed();
 const value=name=>form.elements[name].value.trim();const number=name=>value(name)===''?null:Number(value(name));
 const cents=name=>{const s=value(name);if(!/^\d+(\.\d{1,2})?$/.test(s))throw Error('Enter a taxable amount with at most two decimals.');return Math.round(Number(s)*100);};
 window.InvoiceDeliveryTax={reset(invoice){document.getElementById('dt-delivery').hidden=invoice.kind!=='goods';form.elements.dt_country.value=invoice.request_data.address?.country||'';form.elements.dt_region.value=invoice.request_data.address?.region||'';changed();},read(){
  const components=[];for(let i=0;i<3;i++){if(![value('dt_label_'+i),value('dt_rate_'+i),value('dt_base_'+i),value('dt_reg_'+i)].some(Boolean))continue;const rate=value('dt_rate_'+i);if(!/^\d+(\.\d{1,4})?$/.test(rate))throw Error('Use a tax percentage with at most four decimals.');components.push({label:value('dt_label_'+i),rate_ppm:Math.round(Number(rate)*10000),taxable_cents:cents('dt_base_'+i),registration_number:value('dt_reg_'+i)});}
  return{seller_name:value('dt_seller'),destination_country:value('dt_country'),destination_region:value('dt_region'),tax_mode:value('dt_mode'),gst_hst_number:value('dt_gst'),canada_supply_confirmed:form.elements.dt_ca_confirmed.checked,shipping_taxable:value('dt_shipping_tax')===''?null:value('dt_shipping_tax')==='yes',tax_basis:value('dt_basis'),components,jurisdictions_reviewed:form.elements.dt_jurisdictions.checked,confirmed:form.elements.dt_confirmed.checked,
   reporting_fx:{cad_per_usd_ppm:number('dt_fx')===null?null:Math.round(number('dt_fx')*1000000),date:value('dt_fx_date'),source:value('dt_fx_source')},
   delivery:{origin_country:value('dt_origin'),origin_region:value('dt_origin_region'),carrier:value('dt_carrier'),service:value('dt_service'),quote_reference:value('dt_quote'),quote_expires_at:value('dt_expiry')?new Date(value('dt_expiry')).toISOString():null,handling_max_days:number('dt_handling'),transit_min_days:number('dt_min'),transit_max_days:number('dt_max'),duties:value('dt_duties'),importer:value('dt_importer'),route_review:value('dt_route')}};
 }};
})();
