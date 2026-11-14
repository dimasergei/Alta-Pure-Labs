'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {reconcile}=require('../lib/order-ledger-reconciliation');
test('preserves separate ledgers even if identifiers collide',()=>{const rows=reconcile([{id:'same',created_at:'2026-11-01',payment_status:'paid'}],[{id:'same',created_at:'2026-11-02',status:'void'}]);assert.equal(rows.length,2);assert.deepEqual(rows.map(x=>x.source),['commerce','store']);});
test('deduplicates within a ledger only',()=>{const rows=reconcile([{id:'a'},{id:'a'}],[{id:'b'},{id:'b'}]);assert.equal(rows.length,2);});
test('void invoices are not treated as paid',()=>assert.equal(reconcile([],[{id:'v',status:'void'}])[0].payment_status,'expired'));
test('paid invoices preserve their origin for separate Manage Order handler',()=>{const row=reconcile([],[{id:'p',status:'paid'}])[0];assert.equal(row.source,'commerce');assert.equal(row.payment_status,'paid');});
test('does not mutate input order records',()=>{const a={id:'a',payment_status:'paid'},b={id:'b',status:'void'};reconcile([a],[b]);assert.deepEqual(a,{id:'a',payment_status:'paid'});assert.deepEqual(b,{id:'b',status:'void'});});
