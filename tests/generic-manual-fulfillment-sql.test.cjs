'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const read = name => fs.readFileSync(path.join(__dirname, '../supabase/migrations', name), 'utf8');

test('generic manual fulfillment preserves order lifecycle, historical evidence and real cancellation/postage guards', { timeout: 60000 }, async t => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role; create schema commerce_internal;');
    await db.exec(read('20261110040926_manual_invoice_commerce.sql'));
    await db.exec('alter table commerce_payment_methods add column native_provider text;');
    const supplier = read('20261111174353_partner_settings_supplier_queue.sql');
    await db.exec(supplier.slice(supplier.indexOf('create table public.commerce_supplier_settings'), supplier.indexOf('create table public.commerce_delivery_options')));
    await db.exec(read('20261111195957_unified_supplier_fulfillment.sql'));
    await db.exec(read('20261111210000_single_supplier_per_order.sql'));
    await db.exec(read('20261116140000_unified_order_management.sql'));
    await db.exec(read('20261116150000_purity_manual_fulfillment.sql'));
    // Use the latest pre-change seed, whose storefront reset removed new gifts.
    const regular = read('20261117084413_pure_storefront_regular_pricing.sql');
    const seedStart = regular.indexOf('CREATE OR REPLACE FUNCTION commerce_internal.fulfillment_seed');
    const seedEnd = regular.indexOf('CREATE OR REPLACE FUNCTION commerce_internal.platinum_monthly_reward', seedStart);
    await db.exec(regular.slice(seedStart, seedEnd));
    // Install the actual cancellation trigger, excluding unrelated wallet APIs.
    const cancellation = read('20261117221400_pure_crypto_cancellation_requests.sql');
    await db.exec(cancellation.slice(0, cancellation.indexOf('create function public.commerce_request_polygon_usdc_cancellation')) + '\ncommit;');
    await db.exec('create table store_orders(id uuid primary key,payment_status text,fulfillment_status text,shipping_address jsonb,shipping_name text,tracking_number text);');
    await db.exec(read('20261117221540_pure_admin_shipping_labels.sql'));

    const method = randomUUID();
    await db.query("insert into commerce_payment_methods(id,kind,label,currency,payee,instructions,acceptance_reference,active) values($1,'bank_transfer','Fixture bank','USD','Fixture business','Fixture bank instructions','Fixture accepted method',true)", [method]);
    const items = [{ id: 'a', name: 'Fixture A', size: '10mg', qty: 4 }, { id: 'b', name: 'Fixture B', size: '5mg', qty: 50 }];
    const makeOrder = async ({ status = 'accepted', kind = 'goods', bulk = false, customer = randomUUID(), lines = items } = {}) => {
      const id = randomUUID();
      await db.query(`insert into commerce_invoices(id,customer_id,customer_email,customer_name,kind,plan,request_digest,request_data,status,method_id,payment_snapshot,currency,subtotal_cents,discount_cents,shipping_cents,tax_cents,total_cents)
        values($1,$2,'fixture@example.test','Fixture',$3,$4,$5,$6,$7,$8,'{"kind":"bank_transfer"}','USD',10000,0,0,0,10000)`,
      [id, customer, kind, kind === 'membership' ? 'elite' : null, 'a'.repeat(64), JSON.stringify({ address: { country: 'CA' }, items: lines, bulk_order: bulk }), status, method]);
      return id;
    };
    const load = async id => (await db.query('select * from commerce_invoices where id=$1', [id])).rows[0];
    const allocations = async id => (await db.query('select * from commerce_fulfillment_items where invoice_id=$1 order by variant_key', [id])).rows;
    const jobs = async id => (await db.query('select * from commerce_supplier_jobs where invoice_id=$1', [id])).rows;
    const pay = async id => (await db.query('select commerce_admin_record_bank_payment($1,$2) result', [id, JSON.stringify({ method_id: method, expected_version: 1, receipt_id: randomUUID(), external_reference: 'BANK-' + randomUUID(), confirm_funds_received: true })])).rows[0].result;
    const fulfill = async (id, data) => (await db.query('select commerce_admin_fulfill_order($1,$2) result', [id, JSON.stringify(data)])).rows[0].result;
    const update = (version, status) => ({ action: 'update_order', version, status, note: 'Verified order dispatch details', tracking_carrier: 'Canada Post', tracking_number: 'FIXTURE123456' });
    const paidOrder = async options => { const id = await makeOrder(options); await pay(id); return id; };
    const insertJob = async (id, { status = 'submitted', remote = 'existing-order', payload = {}, providerStatus = null, lease = false } = {}) => {
      await db.query(`insert into commerce_supplier_jobs(invoice_id,reference,status,supplier_id,payload,provider_status,lease_until)
        values($1,$2,$3,$4,$5,$6,case when $7 then now()+interval '5 minutes' else null end)`,
      [id, 'HISTORICAL-' + id, status, remote, payload === null ? null : JSON.stringify(payload), providerStatus, lease]);
    };

    // Capture the real old profile and remote evidence before applying the migration.
    const historical = await paidOrder();
    assert.ok((await allocations(historical)).every(row => row.supplier_name === '99Purity Peptides'));
    const historicRemote = await paidOrder();
    await db.query("update commerce_fulfillment_items set route='lotus',supplier_name='Lotus Labs',product=41,vials=1 where invoice_id=$1", [historicRemote]);
    await insertJob(historicRemote);
    const historicalRows = await allocations(historical), remoteRows = await allocations(historicRemote), remoteJobs = await jobs(historicRemote);
    await db.exec(read('20261118020145_pure_generic_manual_fulfillment.sql'));

    await t.test('migration and repeated seeding retain all historical allocation and request data', async () => {
      assert.deepEqual(await allocations(historical), historicalRows);
      assert.deepEqual(await allocations(historicRemote), remoteRows);
      assert.deepEqual(await jobs(historicRemote), remoteJobs);
      for (const id of [historical, historicRemote]) await db.query('select commerce_internal.fulfillment_seed($1)', [id]);
      assert.deepEqual(await allocations(historical), historicalRows);
      assert.deepEqual(await allocations(historicRemote), remoteRows);
      assert.deepEqual(await jobs(historicRemote), remoteJobs);
    });

    await t.test('new paid regular and bulk orders retain exact quantities without supplier defaults or duplicate seeds', async () => {
      // Old configuration/mappings cannot reactivate the retired routing trigger.
      await db.exec("insert into commerce_supplier_mappings(variant_key,product,vials,supplier_name) values('a|10mg',41,1,'Lotus Labs'); update commerce_supplier_settings set enabled=true,verified_at=now(),max_order_cents=50000;");
      for (const bulk of [false, true]) {
        const id = await makeOrder({ bulk });
        await db.query('select commerce_internal.fulfillment_seed($1)', [id]);
        assert.deepEqual(await allocations(id), []);
        await pay(id);
        const rows = await allocations(id);
        assert.equal(rows.length, 2);
        assert.deepEqual(rows.map(row => row.item), items);
        assert.ok(rows.every(row => row.route === 'manual' && row.supplier_name === '' && row.product === null && row.vials === null));
        assert.deepEqual(await jobs(id), []);
        await db.query('select commerce_internal.fulfillment_seed($1)', [id]);
        assert.deepEqual(await allocations(id), rows);
      }
      const customer = randomUUID(), membership = await makeOrder({ customer, kind: 'membership', lines: [] });
      await pay(membership);
      assert.deepEqual(await allocations(membership), []);
      const memberOrder = await paidOrder({ customer, lines: [items[0]] });
      assert.deepEqual((await allocations(memberOrder)).map(row => row.item), [items[0]], 'no retired membership gift is reintroduced');
    });

    await t.test('unnamed manual orders process, dispatch, correct tracking and deliver with complete audit/quantity updates', async () => {
      const id = await paidOrder();
      assert.equal((await fulfill(id, update(2, 'processing'))).version, 3);
      assert.equal((await fulfill(id, update(3, 'shipped'))).status, 'shipped');
      assert.ok((await allocations(id)).every(row => row.supplier_name === '' && row.status === 'shipped' && row.tracking_number === 'FIXTURE123456'));
      const correction = { action: 'update_tracking', version: 4, note: 'Corrected carrier tracking reference', tracking_carrier: 'UPS', tracking_number: 'CORRECT123456' };
      assert.equal((await fulfill(id, correction)).version, 5);
      assert.equal((await fulfill(id, update(5, 'delivered'))).status, 'delivered');
      assert.ok((await allocations(id)).every(row => row.status === 'delivered' && row.tracking_number === correction.tracking_number));
      assert.equal((await load(id)).tracking_number, correction.tracking_number);
      const actions = (await db.query('select action from commerce_events where invoice_id=$1', [id])).rows.map(row => row.action);
      assert.equal(actions.filter(action => action === 'fulfillment_order_updated').length, 3);
      assert.ok(actions.includes('tracking_corrected'));
      await assert.rejects(fulfill(id, update(6, 'shipped')), /partly dispatched/);
      assert.equal((await load(id)).status, 'delivered');
    });

    await t.test('unpaid, refunded, canceled, nonphysical, stale and malformed dispatches remain blocked', async () => {
      for (const status of ['accepted', 'void', 'refunded']) {
        const id = await makeOrder({ status });
        await assert.rejects(fulfill(id, update(1, 'shipped')), /Paid physical order/);
        assert.equal((await load(id)).status, status);
        assert.deepEqual(await allocations(id), []);
      }
      const membership = await paidOrder({ kind: 'membership', lines: [] });
      await assert.rejects(fulfill(membership, update(2, 'shipped')), /Paid physical order/);
      const id = await paidOrder(), original = await allocations(id);
      await assert.rejects(fulfill(id, update(1, 'shipped')), /Order changed/);
      await assert.rejects(fulfill(id, { ...update(2, 'shipped'), tracking_number: '' }), /Carrier and tracking/);
      await assert.rejects(fulfill(id, { ...update(2, 'shipped'), note: '' }), /audit note/);
      await assert.rejects(fulfill(id, update(2, 'delivered')), /Confirm dispatch/);
      await assert.rejects(fulfill(id, { ...update(2, 'shipped'), action: 'update_tracking' }), /Tracking corrections/);
      assert.equal((await load(id)).status, 'paid');
      assert.deepEqual(await allocations(id), original);
    });

    await t.test('pending/review cancellation triggers roll back every allocation change', async () => {
      for (const status of ['pending', 'review']) {
        const id = await paidOrder();
        await db.query('update commerce_invoices set cancellation_requested_at=now(),cancellation_status=$2 where id=$1', [id, status]);
        const original = await allocations(id);
        await assert.rejects(fulfill(id, update(2, 'processing')), /Cancellation is already requested/);
        await assert.rejects(fulfill(id, update(2, 'shipped')), /Cancellation is already requested/);
        assert.equal((await load(id)).status, 'paid');
        assert.deepEqual(await allocations(id), original);
      }
    });

    await t.test('nonmanual routes, active jobs and unresolved remote requests cannot become manual dispatches', async () => {
      await assert.rejects(fulfill(historicRemote, update(2, 'shipped')), /Manual fulfillment is required/);
      assert.deepEqual(await allocations(historicRemote), remoteRows);
      const remote = await paidOrder(); await insertJob(remote);
      const original = await allocations(remote);
      await assert.rejects(fulfill(remote, update(2, 'shipped')), /Confirm cancellation of the existing fulfillment request/);
      await db.query("update commerce_supplier_jobs set status='cancelled',provider_status='submitted' where invoice_id=$1", [remote]);
      await assert.rejects(fulfill(remote, update(2, 'shipped')), /Confirm cancellation/);
      assert.deepEqual(await allocations(remote), original);
      await db.query("update commerce_supplier_jobs set provider_status='cancelled' where invoice_id=$1", [remote]);
      assert.equal((await fulfill(remote, update(2, 'shipped'))).status, 'shipped', 'confirmed prior cancellation allows an already-manual route to dispatch');
      const leased = await paidOrder(); await insertJob(leased, { remote: null, payload: null, status: 'working', lease: true });
      await assert.rejects(fulfill(leased, update(2, 'processing')), /Fulfillment update in progress/);
      await assert.rejects(fulfill(leased, update(2, 'shipped')), /Fulfillment update in progress/);
      assert.equal((await load(leased)).status, 'paid');
    });

    await t.test('partly dispatched and multiple-parcel orders retain their individual tracking boundaries', async () => {
      const partial = await paidOrder();
      await db.query("update commerce_fulfillment_items set status='shipped',tracking_carrier='UPS',tracking_number='FIRST123' where invoice_id=$1 and variant_key='a|10mg'", [partial]);
      const original = await allocations(partial);
      await assert.rejects(fulfill(partial, update(2, 'shipped')), /partly dispatched/);
      assert.deepEqual(await allocations(partial), original);
      const multi = await paidOrder(); await fulfill(multi, update(2, 'shipped'));
      await db.query("update commerce_fulfillment_items set tracking_number='SECOND123' where invoice_id=$1 and variant_key='b|5mg'", [multi]);
      await assert.rejects(fulfill(multi, { ...update(3, 'shipped'), action: 'update_tracking' }), /multiple parcels/);
      assert.deepEqual((await allocations(multi)).map(row => row.tracking_number), ['FIXTURE123456', 'SECOND123']);
    });

    await t.test('actual live postage purchase/review triggers still hold dispatch atomically', async () => {
      for (const status of ['purchasing', 'review']) {
        const id = await paidOrder(), original = await allocations(id);
        const label = randomUUID();
        await db.query(`insert into admin_shipping_labels(id,source,order_id,status,test_mode,order_snapshot,shipment_id,sender,recipient,parcel,rate_options,selected_rate,expires_at)
          values($1,'commerce',$2,$3,false,'{}','fixture-shipment','{}','{}','{}','[]','{"id":"fixture-rate"}',now()+interval '15 minutes')`, [label, id, status]);
        await assert.rejects(fulfill(id, update(2, 'processing')), /Reconcile the pending shipping label purchase/);
        await assert.rejects(fulfill(id, update(2, 'shipped')), /Reconcile the pending shipping label purchase/);
        assert.deepEqual(await allocations(id), original);
        assert.equal((await load(id)).status, 'paid');
        await db.query("update admin_shipping_labels set status='failed' where id=$1", [label]);
        assert.equal((await fulfill(id, update(2, 'shipped'))).status, 'shipped');
      }
    });

    await t.test('only the server can execute fulfillment and no client can invoke private seeding', async () => {
      const grants = (await db.query(`select
        has_function_privilege('anon','commerce_admin_fulfill_order(uuid,jsonb)','EXECUTE') anon_dispatch,
        has_function_privilege('authenticated','commerce_admin_fulfill_order(uuid,jsonb)','EXECUTE') customer_dispatch,
        has_function_privilege('service_role','commerce_admin_fulfill_order(uuid,jsonb)','EXECUTE') service_dispatch,
        has_function_privilege('anon','commerce_internal.fulfillment_seed(uuid)','EXECUTE') anon_seed,
        has_function_privilege('authenticated','commerce_internal.fulfillment_seed(uuid)','EXECUTE') customer_seed,
        has_function_privilege('service_role','commerce_internal.fulfillment_seed(uuid)','EXECUTE') service_seed,
        (select proconfig from pg_proc where oid='public.commerce_admin_fulfill_order(uuid,jsonb)'::regprocedure) dispatch_config,
        (select proconfig from pg_proc where oid='commerce_internal.fulfillment_seed(uuid)'::regprocedure) seed_config
      `)).rows[0];
      assert.deepEqual(grants, { anon_dispatch: false, customer_dispatch: false, service_dispatch: true, anon_seed: false, customer_seed: false, service_seed: false,
        dispatch_config: ['search_path=pg_catalog, pg_temp'], seed_config: ['search_path=pg_catalog, pg_temp'] });
      const id = await paidOrder();
      for (const role of ['anon', 'authenticated']) {
        await db.exec('set role ' + role);
        try { await assert.rejects(fulfill(id, update(2, 'shipped')), /permission denied/); }
        finally { await db.exec('reset role'); }
      }
      await db.exec('set role service_role');
      try { assert.equal((await fulfill(id, update(2, 'shipped'))).status, 'shipped'); }
      finally { await db.exec('reset role'); }
    });
  } finally { await db.close(); }
});
