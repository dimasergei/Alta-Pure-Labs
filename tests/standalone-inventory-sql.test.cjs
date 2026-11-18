'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { normalizeCommand } = require('../lib/standalone-inventory');
const migration = 'supabase/migrations/20261118024600_pure_standalone_inventory.sql';

test('standalone stock stores only independent rows and atomically preserves count/history/idempotency', { timeout: 60000 }, async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
      alter default privileges in schema public grant all on functions to anon,authenticated,service_role;`);
    await db.exec(fs.readFileSync(migration, 'utf8'));
    const raw = async (payload, requestId = randomUUID()) => (await db.query(
      'select public.pure_stock_command($1,$2::jsonb,$3) as result', [requestId, JSON.stringify(payload), 'admin-session:fixture']
    )).rows[0].result;
    const send = async (input, requestId = randomUUID()) => raw(normalizeCommand({ ...input, request_id: requestId }).payload, requestId);
    const count = async table => Number((await db.query('select count(*) as n from public.' + table)).rows[0].n);
    const item = async id => (await db.query('select * from public.pure_stock_items where id=$1', [id])).rows[0];
    const eventCount = async () => count('pure_stock_events');
    const privileges = (await db.query(`select
      has_table_privilege('anon','public.pure_stock_items','SELECT') as anon_read,
      has_table_privilege('authenticated','public.pure_stock_items','INSERT') as customer_insert,
      has_table_privilege('service_role','public.pure_stock_items','DELETE') as service_delete,
      has_table_privilege('service_role','public.pure_stock_events','UPDATE') as history_update,
      has_table_privilege('service_role','public.pure_stock_events','DELETE') as history_delete,
      has_table_privilege('service_role','public.pure_stock_requests','UPDATE') as replay_update,
      has_function_privilege('anon','public.pure_stock_command(uuid,jsonb,text)','EXECUTE') as anon_execute,
      has_function_privilege('authenticated','public.pure_stock_command(uuid,jsonb,text)','EXECUTE') as customer_execute,
      has_function_privilege('service_role','public.pure_stock_command(uuid,jsonb,text)','EXECUTE') as service_execute,
      (select bool_and(relrowsecurity) from pg_class where oid in ('public.pure_stock_items'::regclass,'public.pure_stock_events'::regclass,'public.pure_stock_requests'::regclass)) as all_rls,
      (select prosecdef from pg_proc where oid='public.pure_stock_command(uuid,jsonb,text)'::regprocedure) as security_definer,
      (select proconfig from pg_proc where oid='public.pure_stock_command(uuid,jsonb,text)'::regprocedure) as function_config
    `)).rows[0];
    assert.deepEqual(privileges, { anon_read:false,customer_insert:false,service_delete:false,history_update:false,history_delete:false,
      replay_update:false,anon_execute:false,customer_execute:false,service_execute:true,all_rls:true,security_definer:false,
      function_config:['search_path=pg_catalog, pg_temp'] });
    assert.equal((await db.query(`select count(*)::integer n from information_schema.tables where table_schema='public' and table_type='BASE TABLE'`)).rows[0].n, 3,
      'the schema works with no catalog, orders, suppliers or other inventory tables');
    for (const role of ['anon','authenticated']) {
      await db.exec('set role ' + role);
      try {
        await assert.rejects(db.query('select * from public.pure_stock_items'), error => error.code==='42501');
        await assert.rejects(raw({ action:'create',item:{sku:'PRIVATE',product_name:'Private'} }), error => error.code==='42501');
      } finally { await db.exec('reset role'); }
    }
    await db.exec('set role service_role');

    const createRequest = randomUUID();
    const createPayload = { action:'create',item:{sku:'custom-001',product_name:'My own item',strength:'Custom size',unit:'pack',unit_cost:12.34,currency:'CAD'} };
    const created = (await send(createPayload, createRequest)).item;
    assert.equal(created.sku,'CUSTOM-001');
    assert.equal(created.quantity,null,'unknown is different from zero');
    assert.equal(created.minimum,0); assert.equal(created.unit,'pack'); assert.equal(created.unit_cost,12.34);
    assert.equal(created.version,1); assert.equal(created.archived,false);
    assert.equal(await eventCount(),1); assert.equal(await count('pure_stock_requests'),1);
    assert.deepEqual((await send(createPayload,createRequest)).item,created);
    assert.equal(await count('pure_stock_items'),1); assert.equal(await eventCount(),1);
    await assert.rejects(send({...createPayload,item:{...createPayload.item,product_name:'Changed'}},createRequest),
      error=>error.code==='P0001'&&error.message==='STOCK_REQUEST_CONFLICT');
    await assert.rejects(send(createPayload),error=>error.code==='23505');
    assert.equal(await eventCount(),1);

    await assert.rejects(send({action:'adjust',id:created.id,expected_version:1,mode:'add',quantity:2,reason:'Received'}),
      error=>error.message==='STOCK_QUANTITY_UNCONFIRMED');
    await assert.rejects(raw({action:'update',id:created.id,expected_version:1,item:{quantity:5},reason:''}),error=>error.code==='22023');
    let current=(await send({action:'adjust',id:created.id,expected_version:1,mode:'set',quantity:8,reason:'Opening physical count'})).item;
    assert.equal(current.quantity,8); assert.equal(current.version,2);
    const afterCount=await eventCount(),requestsAfterCount=await count('pure_stock_requests');
    await assert.rejects(send({action:'adjust',id:created.id,expected_version:2,mode:'remove',quantity:9,reason:'Too many'}),
      error=>error.message==='STOCK_NEGATIVE_QUANTITY');
    assert.equal((await item(created.id)).quantity,8); assert.equal(await eventCount(),afterCount);
    assert.equal(await count('pure_stock_requests'),requestsAfterCount,'failed mutations leave no success receipt');
    const removeRequest=randomUUID(),remove={action:'adjust',id:created.id,expected_version:2,mode:'remove',quantity:2,reason:'Used two packs'};
    current=(await send(remove,removeRequest)).item;
    assert.equal(current.quantity,6); assert.equal(current.version,3);
    assert.deepEqual((await send(remove,removeRequest)).item,current);
    assert.equal((await item(created.id)).quantity,6,'replayed adjustment is not applied twice');

    const competitors=await Promise.allSettled([
      send({action:'update',id:created.id,expected_version:3,item:{notes:'First edit'}}),
      send({action:'update',id:created.id,expected_version:3,item:{location:'Second edit'}})
    ]);
    assert.equal(competitors.filter(x=>x.status==='fulfilled').length,1);
    assert.equal(competitors.find(x=>x.status==='rejected').reason.code,'40001');
    current=await item(created.id); assert.equal(current.version,4); assert.equal(current.quantity,6);
    assert.deepEqual((await send(createPayload,createRequest)).item,created,'old operation replay returns its original immutable result');

    const update=await send({action:'update',id:created.id,expected_version:4,item:{product_name:'Renamed item',unit_cost:null,notes:'Updated\nnotes'}});
    current=update.item; assert.equal(current.quantity,6); assert.equal(current.unit_cost,null); assert.equal(current.version,5);
    const updateEvent=(await db.query("select * from public.pure_stock_events where item_id=$1 and action='update' order by created_at desc,id desc",[created.id])).rows.find(x=>x.changes.product_name);
    assert.deepEqual(updateEvent.changes.product_name,{before:'My own item',after:'Renamed item'});
    assert.equal(updateEvent.quantity_before,6); assert.equal(updateEvent.quantity_after,6);
    const originalEvent=(await db.query("select * from public.pure_stock_events where item_id=$1 and action='create'",[created.id])).rows[0];
    assert.equal(originalEvent.product_name,'My own item','history retains event-time names');

    const noOpCount=await eventCount();
    current=(await send({action:'update',id:created.id,expected_version:5,item:{product_name:'Renamed item'}})).item;
    assert.equal(current.version,5); assert.equal(await eventCount(),noOpCount,'unchanged metadata does not fabricate a change');
    current=(await send({action:'archive',id:created.id,expected_version:5,archived:true})).item;
    assert.equal(current.quantity,6); assert.equal(current.archived,true); assert.equal(current.version,6);
    await assert.rejects(send({action:'adjust',id:created.id,expected_version:6,mode:'set',quantity:0,reason:'Archived'}),
      error=>error.message==='STOCK_ITEM_ARCHIVED');
    await assert.rejects(send(createPayload),error=>error.code==='23505','archived SKUs remain unique');
    current=(await send({action:'archive',id:created.id,expected_version:6,archived:false})).item;
    assert.equal(current.archived,false); assert.equal(current.version,7);

    const beforeImportItems=await count('pure_stock_items'),beforeImportEvents=await eventCount();
    await assert.rejects(raw({action:'import',items:[{sku:'NEW-FIRST',product_name:'Should roll back'},{sku:'custom-001',product_name:'Collision'}],reason:''}),
      error=>error.code==='23505');
    assert.equal(await count('pure_stock_items'),beforeImportItems); assert.equal(await eventCount(),beforeImportEvents);
    await assert.rejects(raw({action:'import',items:[{sku:'same',product_name:'A'},{sku:'SAME',product_name:'B'}],reason:''}),error=>error.code==='23505');
    const imported=await send({action:'import',items:[{sku:'NEW-A',product_name:'Independent A',quantity:0},{sku:'NEW-B',product_name:'Independent B',quantity:11,unit:'pen'}]});
    assert.equal(imported.items.length,2); assert.equal(imported.items[0].quantity,0); assert.equal(imported.items[1].quantity,11);
    const failedRequest=randomUUID(),countBeforeForcedFailure=await count('pure_stock_items'),eventsBeforeForcedFailure=await eventCount();
    await db.exec('reset role');
    await db.exec("alter table public.pure_stock_items add constraint fixture_forced_import_failure check(sku<>'FAIL-LAST')");
    await db.exec('set role service_role');
    await assert.rejects(send({action:'import',items:[{sku:'ROLLBACK-FIRST',product_name:'First insert'},{sku:'FAIL-LAST',product_name:'Fail after first insert'}]},failedRequest),error=>error.code==='23514');
    assert.equal(await count('pure_stock_items'),countBeforeForcedFailure);
    assert.equal(await eventCount(),eventsBeforeForcedFailure,'earlier events roll back with a later failed import row');
    assert.equal((await db.query('select count(*)::integer n from public.pure_stock_requests where request_id=$1',[failedRequest])).rows[0].n,0);
    await db.exec('reset role');
    await db.exec('alter table public.pure_stock_items drop constraint fixture_forced_import_failure');
    await db.exec('set role service_role');

    for(const invalid of [
      {sku:'BAD-QTY',product_name:'Bad',quantity:-1},{sku:'BAD-QTY',product_name:'Bad',quantity:0.5},
      {sku:'BAD-COST',product_name:'Bad',unit_cost:1.234},{sku:'BAD-UNIT',product_name:'Bad',unit:'dose'},
      {sku:'BAD-FIELD',product_name:'Bad',supplier_id:randomUUID()},
      {sku:'BAD-FIELD',product_name:'Bad',order_id:randomUUID()},
      {sku:'BAD-FIELD',product_name:'Bad',catalog_id:'retatrutide'}
    ]) await assert.rejects(raw({action:'create',item:invalid,reason:''}),error=>error.code==='22023');
    await assert.rejects(db.exec("update public.pure_stock_events set reason='erase history'"),error=>error.code==='42501');
    await assert.rejects(db.exec('delete from public.pure_stock_events'),error=>error.code==='42501');
    await assert.rejects(db.exec('delete from public.pure_stock_items'),error=>error.code==='42501');
    await assert.rejects(db.exec("update public.pure_stock_requests set response='{}'"),error=>error.code==='42501');
    await db.exec('reset role');
    const fixtureBefore=[await count('pure_stock_items'),await eventCount(),await count('pure_stock_requests')];
    await db.exec(fs.readFileSync('tests/fixtures/standalone-inventory-checks.sql','utf8'));
    assert.deepEqual([await count('pure_stock_items'),await eventCount(),await count('pure_stock_requests')],fixtureBefore,
      'the hosted verification script leaves no fixture rows or audit events');
  } finally { await db.close(); }
});
