'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const { savePreferences } = require('../lib/admin-shipping-preferences');

const sender = { name: 'PURE', company: '', street1: '200 Example Road', street2: '', city: 'Ottawa', state: 'ON', zip: 'K1P 1J1', country: 'CA', phone: '+16135550100', email: 'sender@example.test' };
const packageDefaults = { length: '20', width: '15', height: '10', distance_unit: 'cm', mass_unit: 'g' };

test('private shipping preferences enforce singleton storage, service-only CAS updates and no reusable packed weight', { timeout: 60000 }, async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    `);
    await db.exec(fs.readFileSync('supabase/migrations/20261118013456_pure_shipping_preferences.sql', 'utf8'));
    const read = async () => (await db.query('select * from public.admin_shipping_preferences')).rows[0];
    const save = async (scope, version, value) => (await db.query('select public.pure_admin_shipping_preferences_save($1,$2,$3) result', [scope, version, value === null ? null : JSON.stringify(value)])).rows[0].result;
    assert.deepEqual(await read(), { id: true, version: 0, sender: null, package_defaults: null, updated_at: null });
    const privileges = (await db.query(`select
      has_table_privilege('anon','public.admin_shipping_preferences','SELECT') anon_read,
      has_table_privilege('authenticated','public.admin_shipping_preferences','SELECT') customer_read,
      has_table_privilege('authenticated','public.admin_shipping_preferences','UPDATE') customer_write,
      has_function_privilege('anon','public.pure_admin_shipping_preferences_save(text,integer,jsonb)','EXECUTE') anon_save,
      has_function_privilege('authenticated','public.pure_admin_shipping_preferences_save(text,integer,jsonb)','EXECUTE') customer_save,
      has_function_privilege('service_role','public.pure_admin_shipping_preferences_save(text,integer,jsonb)','EXECUTE') service_save,
      has_table_privilege('service_role','public.admin_shipping_preferences','DELETE') service_delete,
      (select relrowsecurity from pg_class where oid='public.admin_shipping_preferences'::regclass) rls,
      (select prosecdef from pg_proc where oid='public.pure_admin_shipping_preferences_save(text,integer,jsonb)'::regprocedure) security_definer,
      (select proconfig from pg_proc where oid='public.pure_admin_shipping_preferences_save(text,integer,jsonb)'::regprocedure) function_config
    `)).rows[0];
    assert.deepEqual(privileges, { anon_read: false, customer_read: false, customer_write: false, anon_save: false, customer_save: false,
      service_save: true, service_delete: false, rls: true, security_definer: false, function_config: ['search_path=pg_catalog, pg_temp'] });
    for (const role of ['anon', 'authenticated']) {
      await db.exec('set role ' + role);
      try {
        await assert.rejects(read(), /permission denied/);
        await assert.rejects(save('sender', 0, sender), /permission denied/);
        await assert.rejects(db.query('update public.admin_shipping_preferences set sender=$1 where id=true', [JSON.stringify(sender)]), /permission denied/);
        await assert.rejects(db.query('insert into public.admin_shipping_preferences(id) values(false)'), /permission denied/);
      } finally { await db.exec('reset role'); }
    }

    await db.exec('set role service_role');
    try {
      const initial = await save('sender', 0, sender);
      assert.equal(initial.version, 1);
      assert.deepEqual(initial.sender, sender);
      assert.equal(initial.package_defaults, null);
      assert.ok(initial.updated_at);
      await assert.rejects(save('package', 0, packageDefaults), error => error.code === '40001');
      assert.equal((await read()).version, 1);
      const combined = await save('package', 1, packageDefaults);
      assert.equal(combined.version, 2);
      assert.deepEqual(combined.sender, sender);
      assert.deepEqual(combined.package_defaults, packageDefaults);
      assert.equal(Object.hasOwn(combined.package_defaults, 'weight'), false);

      // Two independent sessions begin with the same version. Exactly one wins;
      // the loser cannot overwrite a newer profile or package update.
      const bridge = { async rpc(name, args) {
        assert.equal(name, 'pure_admin_shipping_preferences_save');
        try { return { data: await save(args.p_scope, args.p_expected_version, args.p_value) }; }
        catch (error) { return { error }; }
      } };
      const concurrent = await Promise.allSettled([
        savePreferences(bridge, { scope: 'sender', version: 2, sender: { ...sender, street1: '300 Updated Example Road' } }),
        savePreferences(bridge, { scope: 'package', version: 2, package_defaults: { ...packageDefaults, length: '25' } })
      ]);
      assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1);
      const loser = concurrent.find(result => result.status === 'rejected');
      assert.equal(loser.reason.status, 409);
      const winner = concurrent.find(result => result.status === 'fulfilled').value;
      let current = await read();
      assert.equal(current.version, 3);
      assert.deepEqual(current.sender, winner.sender);
      assert.deepEqual(current.package_defaults, winner.package_defaults);

      for (const invalid of [
        { ...packageDefaults, weight: '500' }, { ...packageDefaults, note: 'extra' }, { ...packageDefaults, length: '0' },
        { ...packageDefaults, width: '301' }, { ...packageDefaults, distance_unit: 'm' }, { ...packageDefaults, mass_unit: 'tonnes' },
        { ...packageDefaults, height: null }, { ...packageDefaults, length: 20 }, {}, []
      ]) await assert.rejects(save('package', 3, invalid), error => error.code === '22023');
      for (const invalid of [{ ...sender, email: '' }, { ...sender, phone: '123' }, { ...sender, state: '' }, { ...sender, country: 'Canada' }, null]) {
        await assert.rejects(save('sender', 3, invalid), error => error.code === '22023');
      }
      await assert.rejects(db.query('update public.admin_shipping_preferences set package_defaults=$1 where id=true', [JSON.stringify({ ...packageDefaults, weight: '500' })]), error => error.code === '23514');
      await assert.rejects(db.query('insert into public.admin_shipping_preferences(id) values(false)'), error => error.code === '23514');
      current = await read();
      assert.equal(current.version, 3, 'invalid and stale writes do not advance the version');
      const cleared = await save('package', 3, null);
      assert.equal(cleared.version, 4);
      assert.equal(cleared.package_defaults, null);
      assert.deepEqual(cleared.sender, current.sender, 'clearing a package cannot erase the personal return address');
    } finally { await db.exec('reset role'); }
  } finally { await db.close(); }
});
