'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {normalizeSheet, loadFulfillmentSheet, buildFulfillmentCsv, buildFulfillmentPdf} = require('../lib/admin-fulfillment-sheet');
const id = '52788339-e005-4ee8-a851-200ba27496e3';
const date = '2026-11-16T12:00:00.000Z';
function order(overrides = {}) {
  return { id, kind: 'goods', status: 'accepted', created_at: date,
    customer_name: 'Example Research', customer_email: 'shipping@example.test',
    request_data: { name: 'Dr. Example', organization: 'Example Lab', phone: '+1 555 010 1234',
      address: { line1: '10 Example Street', line2: 'Suite 101', city: 'New York', region: 'NY', postal_code: '10001', country: 'US' },
      items: [{id:'bpc-157', name:'BPC-157', size:'10mg', qty:4}], checkout: {delivery:{shipping:'express',extras:['priority']}}, note:'PRIVATE-CUSTOMER-NOTE'
    }, pricing:{lines:[{id:'bpc-157',name:'BPC-157',size:'10mg',qty:4,bogo_free_units:2,gross_cents:12345678}],delivery:{selection:{shipping:'express'}}},
    payment_snapshot:{account_number:'PRIVATE-ACCOUNT-123',instructions:'PRIVATE-PAYMENT-INSTRUCTIONS'},
    admin_notes:'PRIVATE-ADMIN-NOTE',total_cents:987654321, ...overrides };
}
function sheet(overrides = {}, args = {}) { return normalizeSheet({order:order(overrides),source:'commerce',generatedAt:date,...args}); }
function allocation(extra = {}) { return {variant_key:'bpc-157|10mg',item:{id:'bpc-157',name:'BPC-157',size:'10mg',qty:4},route:'manual',supplier_name:'Example Supplier',status:'pending',...extra}; }

test('unpaid current order exports full contact and physical BOGO units under a DO NOT SHIP banner', () => {
  const s=sheet();
  assert.equal(s.release.ready,false); assert.match(s.release.title,/DRAFT/); assert.match(s.release.reason,/DO NOT SHIP/);
  assert.deepEqual([s.items[0].purchased,s.items[0].free,s.items[0].total],[2,2,4]);
  assert.equal(s.ship_to.recipient,'Dr. Example'); assert.equal(s.ship_to.phone,'+1 555 010 1234');
  assert.equal(s.shipping_service,'Express UPS'); assert.equal(s.handling,'Priority processing');
  for(const out of [buildFulfillmentCsv(s).toString('utf8'),buildFulfillmentPdf(s).toString('latin1')]) {
    assert.match(out,/10 Example Street/); assert.match(out,/Suite 101/); assert.match(out,/shipping@example.test/);
    assert.doesNotMatch(out,/PRIVATE-|12345678|987654321|gross_cents|payment_snapshot|admin_notes/);
  }
});

test('unallocated orders name 99Purity as intended manual supplier without inventing a SKU or submission', () => {
  const s=sheet();
  assert.equal(s.items[0].supplier,'99Purity Peptides');
  assert.equal(s.items[0].route,'manual');
  assert.equal(s.items[0].supplier_sku,'');
  assert.equal(s.items[0].fulfillment_status,'unallocated');
  assert.equal(s.supplier_order,'');
  assert.equal(s.release.ready,false);
  for(const output of [buildFulfillmentCsv(s).toString('utf8'),buildFulfillmentPdf(s).toString('latin1')]) {
    assert.match(output,/99Purity Peptides/);
    assert.doesNotMatch(output,/Lotus/);
    assert.match(output,/DO NOT SHIP/);
  }
});

test('99Purity paid allocations export exact physical units and preserve historical supplier evidence', () => {
  const manual=sheet({status:'paid'},{allocations:[allocation({supplier_name:'99Purity Peptides'})]});
  assert.equal(manual.items[0].supplier,'99Purity Peptides');
  assert.equal(manual.items[0].total,4);
  assert.equal(manual.release.ready,true);
  const previous=sheet({status:'paid'},{allocations:[allocation({supplier_name:'Lotus Labs',route:'lotus',product:41,vials:1})],jobs:[{supplier_id:'L-EXISTING'}]});
  assert.equal(previous.items[0].supplier,'Lotus Labs');
  assert.match(previous.items[0].supplier_sku,/Lotus product 41/);
  assert.equal(previous.release.ready,false);
  assert.match(previous.release.title,/SUPPLIER ACTIVITY/);
});

test('bulk order preserves total units without promotional quantities and gift allocation is included', () => {
  const raw=order({status:'paid'}); raw.request_data.bulk_order=true; raw.request_data.items[0].qty=50;
  raw.pricing.lines[0].qty=50; delete raw.pricing.lines[0].bogo_free_units;
  const gift={variant_key:'gift-bac-3|3 mL',item:{id:'gift-bac-3',name:'Complimentary BAC Water',size:'3 mL',qty:1,membership_gift:true},route:'manual',status:'pending'};
  const s=normalizeSheet({order:raw,source:'commerce',allocations:[allocation({item:{...raw.request_data.items[0]}}),gift]});
  assert.equal(s.order_type,'Bulk order'); assert.deepEqual(s.items.map(x=>[x.purchased,x.free,x.total]),[[50,0,50],[0,1,1]]);
  assert.equal(s.release.ready,true);
});

test('paid manual order has fulfillment sheet; canceled, refunded, dispatched and Lotus orders cannot look like new releases', () => {
  assert.equal(sheet({status:'paid'},{allocations:[allocation()]}).release.ready,true);
  for(const status of ['void','refunded','shipped','delivered']) {
    const s=sheet({status}); assert.equal(s.release.ready,false); assert.match(s.release.title,/HOLD|REFERENCE/);
  }
  const mapped=sheet({status:'paid'},{allocations:[allocation({route:'lotus',product:16,vials:1})]});
  assert.match(mapped.release.title,/LOTUS ROUTED/); assert.match(mapped.items[0].supplier_sku,/Lotus product 16 \/ 1 vial pack/);
  const existing=sheet({status:'paid'},{allocations:[allocation()],jobs:[{supplier_id:'L-100',reference:'ALTA-'+id}]});
  assert.equal(existing.release.ready,false); assert.match(existing.release.title,/SUPPLIER ACTIVITY/);
  assert.match(buildFulfillmentCsv(existing).toString(),/L-100/);
});

test('quantity mismatch and unknown extra allocations stop exports instead of causing wrong fulfillment', () => {
  assert.throws(()=>sheet({}, {allocations:[allocation({item:{id:'bpc-157',size:'10mg',qty:2}})]}),/quantities and fulfillment allocations differ/);
  assert.throws(()=>sheet({}, {allocations:[allocation({variant_key:'unknown|5mg'})]}),/extra fulfillment allocation/);
  const raw=order();raw.pricing.lines[0].bogo_free_units=5;
  assert.throws(()=>normalizeSheet({order:raw,source:'commerce'}),/Promotional quantities/);
});

test('missing address or shipping service is held and private route review is excluded', () => {
  const raw=order({status:'paid'});delete raw.request_data.address.line1;
  assert.match(normalizeSheet({order:raw,source:'commerce'}).release.title,/SHIPPING DETAILS/);
  const quoted=order();quoted.pricing.delivery_tax={delivery:{carrier:'UPS',service:'Ground'},private_review:{shipping_quote_reference:'PRIVATE-SUPPLIER-QUOTE'}};
  const s=normalizeSheet({order:quoted,source:'commerce'});
  assert.equal(s.shipping_service,'UPS / Ground');assert.doesNotMatch(buildFulfillmentCsv(s).toString(),/PRIVATE-SUPPLIER-QUOTE/);
});

test('legacy order export preserves quantities and says the purchased/free split is unavailable', () => {
  const s=normalizeSheet({source:'store',order:{id,order_number:'AP-1234',created_at:date,customer_name:'Legacy Customer',customer_email:'legacy@example.test',payment_status:'paid',fulfillment_status:'processing',shipping_address:{line1:'1 Main',city:'Austin',state:'TX',postal_code:'78701',country:'US',service:'UPS Ground'},store_order_items:[{product_id:'p1',product_name:'Peptide',variant_size:'5mg',quantity:3,supplier_sku:'SKU-5MG',supplier_name:'Supplier',lot_number:'LOT-1',fulfillment_notes:'PRIVATE-NOTES'}]}});
  assert.equal(s.items[0].total,3);assert.equal(s.items[0].purchased,null);assert.equal(s.items[0].free,null);
  const csv=buildFulfillmentCsv(s).toString();assert.match(csv,/Not recorded/);assert.match(csv,/SKU-5MG/);assert.doesNotMatch(csv,/PRIVATE-NOTES/);
  assert.equal(s.release.ready,true);
});

test('CSV is UTF-8 with quoted fields, CRLF and formula injection disabled', () => {
  const raw=order();raw.request_data.name='=HYPERLINK("https://bad.example")';raw.request_data.organization='研究室';
  const csv=buildFulfillmentCsv(normalizeSheet({order:raw,source:'commerce'})).toString('utf8');
  assert.equal(csv.charCodeAt(0),0xfeff);assert.match(csv,/"'=HYPERLINK\(""https:\/\/bad.example""\)"/);assert.match(csv,/研究室/);assert.match(csv,/\r\n/);
});

test('PDF fails explicitly for unsupported recipient glyphs rather than corrupting shipping details', () => {
  const raw=order();raw.request_data.name='王明';
  assert.throws(()=>buildFulfillmentPdf(normalizeSheet({order:raw,source:'commerce'})),/Download the UTF-8 CSV/);
});

test('PDF xref offsets are valid and payment hold is repeated on every page', () => {
  const raw=order();raw.request_data.items=Array.from({length:25},(_,i)=>({id:'p'+i,name:'Research product '+i,size:'10mg',qty:2}));
  raw.pricing.lines=[];
  const pdf=buildFulfillmentPdf(normalizeSheet({order:raw,source:'commerce',generatedAt:date})).toString('latin1');
  assert.match(pdf,/^%PDF-1.4/);const count=Number(/\/Type \/Pages[^]*?\/Count (\d+)/.exec(pdf)[1]);assert.ok(count>2);
  assert.equal(pdf.split('(DRAFT - PAYMENT NOT CONFIRMED)').length-1,count);
  const xref=Number(/startxref\n(\d+)/.exec(pdf)[1]);assert.equal(pdf.slice(xref,xref+4),'xref');
  const entries=pdf.slice(xref).split('\n').slice(3).filter(x=>/^\d{10} 00000 n/.test(x));
  entries.forEach((x,i)=>assert.equal(pdf.slice(Number(x.slice(0,10))).startsWith((i+1)+' 0 obj\n'),true));
});

function fakeDb(tables) {
  const reads=[];
  return {reads,from(table){reads.push(table);let key;return {select(){return this},eq(_,id){key=id;return this},maybeSingle(){return Promise.resolve({data:tables[table]??null,error:null})},then(resolve){return Promise.resolve({data:tables[table]??[],error:null}).then(resolve)},insert(){throw Error('Mutation forbidden')},update(){throw Error('Mutation forbidden')},delete(){throw Error('Mutation forbidden')}}}};
}
test('server loader resolves only requested order and does not mutate records or call supplier APIs', async () => {
  const db=fakeDb({commerce_invoices:order(),commerce_fulfillment_items:[],commerce_supplier_jobs:[]});
  const s=await loadFulfillmentSheet(db,new URLSearchParams({id,source:'commerce'}));
  assert.equal(s.id,id);assert.deepEqual(db.reads,['commerce_invoices','commerce_fulfillment_items','commerce_supplier_jobs']);
});
test('loader validates IDs/sources and membership/subscription non-shippable records', async () => {
  const db=fakeDb({commerce_invoices:order({kind:'membership'})});
  await assert.rejects(loadFulfillmentSheet(db,new URLSearchParams({id:'bad'})),/valid order/);
  await assert.rejects(loadFulfillmentSheet(db,new URLSearchParams({id,source:'research_subscription'})),/paid delivery order/);
  await assert.rejects(loadFulfillmentSheet(db,new URLSearchParams({id,source:'commerce'})),/Membership purchases/);
  assert.deepEqual(db.reads,['commerce_invoices']);
});
