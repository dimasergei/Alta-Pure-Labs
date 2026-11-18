'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const shipping = require('../lib/admin-shipping-labels');
const { snapshot } = shipping;
test('SQL label claims enforce paid/stale/cancellation/duplicate guards and private privileges', { timeout: 60000 }, async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table commerce_invoices(id uuid primary key,kind text,status text,version int,request_data jsonb,tracking_number text,cancellation_status text);
      create table store_orders(id uuid primary key,payment_status text,fulfillment_status text,shipping_address jsonb,shipping_name text,tracking_number text);
      create table commerce_supplier_jobs(invoice_id uuid,supplier_id text,payload jsonb,status text,lease_until timestamptz);
      create table commerce_fulfillment_items(invoice_id uuid,route text,status text,item jsonb,tracking_number text);
      grant select on commerce_invoices,store_orders,commerce_supplier_jobs,commerce_fulfillment_items to service_role;
    `);
    await db.exec(fs.readFileSync('supabase/migrations/20261117221540_pure_admin_shipping_labels.sql', 'utf8'));
    const rate = { id: 'a'.repeat(32), amount_cents: 825, currency: 'USD' };
    const makeOrder = async (overrides = {}, source = 'commerce') => {
      const order = { id: randomUUID(), kind: 'goods', status: 'paid', version: 2, request_data: { address: { country: 'US' }, items: [{ id: 'fixture', qty: 1 }] }, tracking_number: '', ...overrides };
      if (source === 'commerce') await db.query('insert into commerce_invoices values($1,$2,$3,$4,$5,$6,$7)', [order.id, order.kind, order.status, order.version, JSON.stringify(order.request_data), order.tracking_number, order.cancellation_status || null]);
      else await db.query('insert into store_orders values($1,$2,$3,$4,$5,$6)', [order.id, order.payment_status, order.fulfillment_status, JSON.stringify(order.shipping_address), order.shipping_name, order.tracking_number]);
      return order;
    };
    const makeQuote = async (order, source = 'commerce', test = false, expired = false) => {
      const id = randomUUID();
      await db.query(`insert into admin_shipping_labels(id,source,order_id,status,test_mode,order_snapshot,shipment_id,sender,recipient,parcel,rate_options,expires_at)
        values($1,$2,$3,'quoted',$4,$5,'shipment','{}','{}','{}',$6,now()+($7::text)::interval)`, [id, source, order.id, test, JSON.stringify(snapshot(order, source)), JSON.stringify([rate]), expired ? '-1 minute' : '15 minutes']);
      return id;
    };
    const claim = async (id, amount = 825) => (await db.query('select pure_shipping_label_claim($1,$2,$3,$4) result', [id, rate.id, amount, 'USD'])).rows[0].result;
    const record = async (id, status, result = {}, transaction = 'b'.repeat(32), testMode = false, rateId = rate.id) => (await db.query('select pure_shipping_label_record($1,$2,$3,$4,$5,$6) result', [id, transaction, rateId, testMode, status, JSON.stringify({ message: status, ...result })])).rows[0].result;
    for (const overrides of [{ status: 'accepted' }, { status: 'refunded' }, { kind: 'membership' }, { cancellation_status: 'pending' }, { cancellation_status: 'review' }, { tracking_number: 'EXISTING' }]) {
      const order = await makeOrder(overrides); await assert.rejects(claim(await makeQuote(order)), /not ready/);
    }
    // Saving a preview while unpaid is allowed. The real SQL claim, reached
    // through the JavaScript purchase path, must still prevent any provider POST.
    for (const source of ['commerce', 'store']) {
      const unpaid = await makeOrder(source === 'commerce' ? { status: 'accepted' }
        : { payment_status: 'pending', fulfillment_status: 'unfulfilled', shipping_address: {}, shipping_name: '' }, source);
      const preview = await makeQuote(unpaid, source);
      const savedPreview = (await db.query('select * from admin_shipping_labels where id=$1', [preview])).rows[0];
      let providerCalls = 0, claimCalls = 0;
      const bridge = {
        from(table) {
          assert.equal(table, 'admin_shipping_labels');
          const q = { select() { return q; }, eq() { return q; }, async maybeSingle() { return { data: savedPreview }; } };
          return q;
        },
        async rpc(name, args) {
          assert.equal(name, 'pure_shipping_label_claim'); claimCalls++;
          try { return { data: (await db.query('select pure_shipping_label_claim($1,$2,$3,$4) result', [args.p_id, args.p_rate, args.p_amount, args.p_currency])).rows[0].result }; }
          catch (error) { assert.match(error.message, /not ready/); return { error }; }
        }
      };
      await assert.rejects(shipping.purchase(bridge, {
        id: unpaid.id, source, label_id: preview, rate_id: rate.id, amount_cents: rate.amount_cents, currency: rate.currency, confirm_purchase: true
      }, { env: { SHIPPO_MODE: 'live', SHIPPO_API_TOKEN: 'shippo_live_fixture', SHIPPO_ALLOW_LIVE_PURCHASES: 'true' },
        fetch: async () => { providerCalls++; throw new Error('Unpaid orders must never reach Shippo transactions.'); } }), /order or rate changed/);
      assert.equal(claimCalls, 1);
      assert.equal(providerCalls, 0);
      assert.equal((await db.query('select status from admin_shipping_labels where id=$1', [preview])).rows[0].status, 'quoted');
      if (source === 'commerce') {
        await db.query("update commerce_invoices set status='paid',version=version+1 where id=$1", [unpaid.id]);
        unpaid.status = 'paid'; unpaid.version++;
      } else {
        await db.query("update store_orders set payment_status='paid' where id=$1", [unpaid.id]);
        unpaid.payment_status = 'paid';
      }
      await assert.rejects(claim(preview), /changed after quotation/, 'a preview obtained before payment cannot be bought after payment without a fresh quote');
      assert.equal((await claim(await makeQuote(unpaid, source))).claimed, true, 'a fresh paid quote can be claimed without weakening the snapshot guard');
    }
    const stale = await makeOrder(), staleQuote = await makeQuote(stale);
    await db.query('update commerce_invoices set version=version+1 where id=$1', [stale.id]); await assert.rejects(claim(staleQuote), /changed after quotation/);
    const expired = await makeOrder(); await assert.rejects(claim(await makeQuote(expired, 'commerce', false, true)), /expired/);
    const order = await makeOrder(), first = await makeQuote(order), second = await makeQuote(order);
    await db.query("insert into commerce_fulfillment_items(invoice_id,route,status,item) values($1,'manual','pending','{\"id\":\"fixture\"}')", [order.id]);
    await db.query("insert into commerce_supplier_jobs(invoice_id,status) values($1,'blocked')", [order.id]);
    await assert.rejects(claim(first, 1), /rate changed/);
    assert.equal((await claim(first)).claimed, true); assert.equal((await claim(first)).claimed, false);
    await assert.rejects(claim(second), /already exists/);
    await assert.rejects(db.query("update commerce_invoices set status='refunded' where id=$1", [order.id]), /Reconcile/);
    await assert.rejects(db.query("update commerce_invoices set request_data='{}' where id=$1", [order.id]), /Reconcile/);
    for (const sql of [
      "update commerce_fulfillment_items set route='lotus' where invoice_id=$1",
      "update commerce_fulfillment_items set status='ordered' where invoice_id=$1",
      "update commerce_fulfillment_items set item='{}' where invoice_id=$1",
      "update commerce_fulfillment_items set tracking_number='SENT' where invoice_id=$1",
      'delete from commerce_fulfillment_items where invoice_id=$1',
      "insert into commerce_fulfillment_items(invoice_id,route,status) values($1,'lotus','pending')",
      "update commerce_supplier_jobs set status='working',lease_until=now()+interval '1 minute' where invoice_id=$1",
      "update commerce_supplier_jobs set payload='{}' where invoice_id=$1",
      'delete from commerce_supplier_jobs where invoice_id=$1',
      "insert into commerce_supplier_jobs(invoice_id,status) values($1,'queued')"
    ]) await assert.rejects(db.query(sql, [order.id]), /Reconcile/);
    await db.query("update admin_shipping_labels set status='review' where id=$1", [first]); await assert.rejects(claim(second), /already exists/);
    await db.query("update admin_shipping_labels set status='failed' where id=$1", [first]); assert.equal((await claim(second)).claimed, true);
    await db.query("update admin_shipping_labels set status='created' where id=$1", [second]);
    await db.query("update commerce_invoices set status='processing' where id=$1", [order.id]);
    await db.query("update commerce_fulfillment_items set status='ordered' where invoice_id=$1", [order.id]);
    const remote = await makeOrder(); await db.query("insert into commerce_supplier_jobs(invoice_id,supplier_id,status) values($1,'existing','submitted')", [remote.id]); await assert.rejects(claim(await makeQuote(remote)), /supplier shipment/);
    const legacy = await makeOrder({ payment_status: 'paid', fulfillment_status: 'unfulfilled', shipping_address: {}, shipping_name: '' }, 'store');
    assert.equal((await claim(await makeQuote(legacy, 'store'))).claimed, true);
    const mode = await makeOrder(); const testQuote = await makeQuote(mode, 'commerce', true); await claim(testQuote);
    await db.query("update commerce_invoices set status='processing' where id=$1", [mode.id]); mode.status='processing';
    await db.query("insert into commerce_fulfillment_items(invoice_id,route,status,item) values($1,'manual','pending','{}')", [mode.id]);
    await db.query("update commerce_fulfillment_items set item='{\"id\":\"fixture\",\"qty\":1}' where invoice_id=$1", [mode.id]);
    await db.query("insert into commerce_supplier_jobs(invoice_id,status) values($1,'blocked')", [mode.id]);
    await db.query("update commerce_supplier_jobs set status='queued' where invoice_id=$1", [mode.id]);
    assert.equal((await claim(await makeQuote(mode))).claimed, true, 'an unresolved test label does not block a live purchase or freeze fulfillment edits');

    const savedOrder=await makeOrder(), saved=await makeQuote(savedOrder);await claim(saved);
    const file='https://labels.example.test/confirmed.pdf';
    assert.equal((await record(saved,'SUCCESS',{label_url:file})).status,'created','untracked carrier service can complete with a label file');
    await record(saved,'SUCCESS',{label_url:file,tracking_number:'TRACK123',tracking_url:'https://tracking.example.test/TRACK123'});
    for (const status of ['WAITING','QUEUED','ERROR','UNKNOWN']) {
      const retained=await record(saved,status,{label_url:null,tracking_number:null});
      assert.equal(retained.status,'created');assert.equal(retained.label_url,file);assert.equal(retained.tracking_number,'TRACK123');assert.equal(retained.provider_status,'SUCCESS');
    }
    await assert.rejects(record(saved,'SUCCESS',{label_url:file},'c'.repeat(32)),/does not match/);
    await assert.rejects(record(saved,'SUCCESS',{label_url:file},'b'.repeat(32),true),/does not match/);
    await assert.rejects(record(saved,'SUCCESS',{label_url:file},'b'.repeat(32),false,'d'.repeat(32)),/does not match/);
    await assert.rejects(db.query('update admin_shipping_labels set transaction_id=null where id=$1',[saved]),/cannot be replaced or cleared/);
    assert.equal((await record(saved,'REFUNDPENDING')).status,'review');
    await assert.rejects(db.query("update commerce_invoices set status='processing' where id=$1",[savedOrder.id]),/Reconcile/);
    assert.equal((await record(saved,'SUCCESS',{label_url:file})).provider_status,'REFUNDPENDING','old success cannot remove a refund hold');
    const rejected=await record(saved,'REFUNDREJECTED');assert.equal(rejected.status,'created');assert.equal(rejected.label_url,file);assert.equal(rejected.tracking_number,'TRACK123');
    assert.equal((await record(saved,'REFUNDPENDING')).status,'created','old refund-pending cannot replace confirmed rejection');
    const refunded=await record(saved,'REFUNDED');assert.equal(refunded.status,'refunded');assert.equal(refunded.transaction_id,'b'.repeat(32));
    for (const status of ['WAITING','SUCCESS','REFUNDREJECTED']) assert.equal((await record(saved,status,{label_url:file})).status,'refunded');
    assert.equal((await claim(await makeQuote(savedOrder))).claimed,true,'a provider-confirmed refund releases duplicate-postage guard');

    const failedOrder=await makeOrder(), failed=await makeQuote(failedOrder);await claim(failed);
    assert.equal((await record(failed,'ERROR',{},'e'.repeat(32))).status,'failed');
    assert.equal((await record(failed,'QUEUED',{},'e'.repeat(32))).status,'failed','old queued result cannot reopen a terminal failure');
    const roleOrder=await makeOrder(), roleQuote=await makeQuote(roleOrder);
    await db.exec('set role service_role');
    try {
      assert.equal((await claim(roleQuote)).claimed,true,'service role can claim safely without direct UPDATE rights on the order');
      assert.equal((await record(roleQuote,'SUCCESS',{label_url:file},'f'.repeat(32))).status,'created');
    } finally { await db.exec('reset role'); }
    const privileges = (await db.query(`select
      has_table_privilege('anon','admin_shipping_labels','SELECT') anon_read,
      has_table_privilege('authenticated','admin_shipping_labels','UPDATE') customer_write,
      has_function_privilege('anon','pure_shipping_label_claim(uuid,text,integer,text)','EXECUTE') anon_buy,
      has_function_privilege('service_role','pure_shipping_label_claim(uuid,text,integer,text)','EXECUTE') admin_buy,
      has_function_privilege('anon','pure_shipping_label_record(uuid,text,text,boolean,text,jsonb)','EXECUTE') anon_record,
      has_function_privilege('authenticated','pure_shipping_label_record(uuid,text,text,boolean,text,jsonb)','EXECUTE') customer_record,
      has_function_privilege('service_role','pure_shipping_label_record(uuid,text,text,boolean,text,jsonb)','EXECUTE') admin_record,
      (select relrowsecurity from pg_class where oid='admin_shipping_labels'::regclass) rls`)).rows[0];
    assert.deepEqual(privileges, { anon_read: false, customer_write: false, anon_buy: false, admin_buy: true, anon_record:false, customer_record:false, admin_record:true, rls: true });
  } finally { await db.close(); }
});
