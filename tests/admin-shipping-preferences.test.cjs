'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readPreferences, savePreferences } = require('../lib/admin-shipping-preferences');

const sender = { name: 'PURE', company: '', street1: '200 Example Road', street2: '', city: 'Ottawa', state: 'ON', zip: 'K1P 1J1', country: 'CA', phone: '+1 (613) 555-0100', email: 'sender@example.test' };
const packageDefaults = { length: '20', width: '15', height: '10', distance_unit: 'cm', mass_unit: 'g' };

function fixture(initial = null) {
  let row = initial;
  const calls = [];
  const db = {
    from(table) {
      assert.equal(table, 'admin_shipping_preferences');
      const q = { select(columns) { assert.equal(columns, 'version,sender,package_defaults,updated_at'); return q; },
        eq(key, value) { assert.equal(key, 'id'); assert.equal(value, true); return q; },
        async maybeSingle() { return { data: row }; } };
      return q;
    },
    async rpc(name, args) {
      calls.push({ name, args });
      assert.equal(name, 'pure_admin_shipping_preferences_save');
      if (args.p_expected_version !== (row?.version || 0)) return { error: { code: '40001', message: 'internal details must not be exposed' } };
      row = { ...(row || { id: true, version: 0, sender: null, package_defaults: null }),
        [args.p_scope === 'sender' ? 'sender' : 'package_defaults']: args.p_value, version: (row?.version || 0) + 1, updated_at: '2026-11-18T02:00:00Z' };
      return { data: row };
    }
  };
  return { db, calls, row: () => row };
}

test('an empty saved profile returns version zero without an invented address or package', async () => {
  const h = fixture();
  assert.deepEqual(await readPreferences(h.db), { version: 0, sender: null, package_defaults: null, updated_at: null });
  assert.equal(h.calls.length, 0);
});

test('sender and package saves preserve the other scope and return a plain preferences object', async () => {
  const h = fixture();
  let result = await savePreferences(h.db, { action: 'shipping_preferences_save', scope: 'sender', version: 0, sender: { ...sender, country: ' ca ', street1: ' 200 Example Road ' } });
  assert.equal(result.version, 1);
  assert.deepEqual(result.sender, sender);
  assert.equal(result.package_defaults, null);
  assert.equal(result.id, undefined);
  result = await savePreferences(h.db, { action: 'shipping_preferences_save', scope: 'package', version: 1, package_defaults: { ...packageDefaults, length: 20 } });
  assert.equal(result.version, 2);
  assert.deepEqual(result.sender, sender);
  assert.deepEqual(result.package_defaults, packageDefaults);
  assert.equal(Object.hasOwn(result.package_defaults, 'weight'), false);
  result = await savePreferences(h.db, { scope: 'package', version: 2, package_defaults: null });
  assert.equal(result.version, 3);
  assert.equal(result.package_defaults, null);
  assert.deepEqual(result.sender, sender);
  assert.deepEqual(await readPreferences(h.db), result);
});

test('sender profiles require an address, email and plausible phone before reaching storage', async () => {
  const h = fixture();
  for (const change of [
    { street1: '' }, { email: '' }, { email: 'not-an-email' }, { phone: '' }, { phone: 'call me' }, { phone: '123' }, { phone: '1'.repeat(16) }
  ]) await assert.rejects(savePreferences(h.db, { scope: 'sender', version: 0, sender: { ...sender, ...change } }), error => error.status === 400);
  assert.equal(h.calls.length, 0);
  assert.equal(h.row(), null);
});

test('package defaults reject packed weight and invalid dimensions or units before storage', async () => {
  const h = fixture();
  for (const value of [
    { ...packageDefaults, weight: '500' }, { ...packageDefaults, weight: undefined },
    { ...packageDefaults, length: '0' }, { ...packageDefaults, width: '301' }, { ...packageDefaults, height: '-2' },
    { ...packageDefaults, length: '1.00001' }, { ...packageDefaults, distance_unit: 'm' }, { ...packageDefaults, mass_unit: 'tonnes' },
    { ...packageDefaults, note: 'unsupported' }, {}, [], undefined
  ]) await assert.rejects(savePreferences(h.db, { scope: 'package', version: 0, package_defaults: value }), error => error.status === 400);
  assert.equal(h.calls.length, 0);
});

test('compare-and-swap conflicts require reload instead of silently replacing another save', async () => {
  const h = fixture();
  await savePreferences(h.db, { scope: 'sender', version: 0, sender });
  await assert.rejects(savePreferences(h.db, { scope: 'package', version: 0, package_defaults: packageDefaults }), error => {
    assert.equal(error.status, 409); assert.match(error.message, /another session.*Reload/); assert.doesNotMatch(error.message, /internal details/); return true;
  });
  assert.deepEqual(h.row().sender, sender);
  assert.equal(h.row().package_defaults, null);
  assert.equal(h.row().version, 1);
  for (const version of [-1, '1', 1.5, undefined, 2147483647]) await assert.rejects(savePreferences(h.db, { scope: 'package', version, package_defaults: packageDefaults }), error => error.status === 400);
  await assert.rejects(savePreferences(h.db, { scope: 'unknown', version: 1 }), error => error.status === 400);
});

test('read representation excludes weight and private storage fields, and failures remain generic', async () => {
  const h = fixture({ id: true, version: 5, sender: { ...sender, extra_private_field: 'hidden' }, package_defaults: { ...packageDefaults, weight: '999' }, updated_at: '2026-11-18T02:00:00Z', private_note: 'hidden' });
  const result = await readPreferences(h.db);
  assert.deepEqual(result.package_defaults, packageDefaults);
  assert.equal(result.sender.extra_private_field, undefined);
  assert.equal(result.private_note, undefined);
  const unavailable = { from() { const q = { select() { return q; }, eq() { return q; }, async maybeSingle() { return { error: { message: 'private database details' } }; } }; return q; } };
  await assert.rejects(readPreferences(unavailable), error => error.status === 503 && !error.message.includes('private database'));
});
