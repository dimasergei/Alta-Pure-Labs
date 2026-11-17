'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
let PGlite; try { ({ PGlite } = require('@electric-sql/pglite')); } catch {}
const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261117192716_pure_passwordless_admin_sessions.sql'), 'utf8');
const digest = text => createHash('sha256').update(text).digest('hex');

test('executed PostgreSQL auth storage enforces nonce, session, throttle and role boundaries', { skip: !PGlite, timeout: 60000 }, async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      alter default privileges in schema public grant execute on functions to anon, authenticated;`);
    await db.exec(migration);
    const funcs = [
      'pure_admin_request_login(text,text,text,timestamptz)',
      'pure_admin_create_session(text,text,timestamptz,text)',
      'pure_admin_get_session(text,text)', 'pure_admin_revoke_session(text)'
    ];
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const expected = role === 'service_role';
      const schema = (await db.query("select has_schema_privilege($1,'pure_admin','USAGE') allowed", [role])).rows[0];
      assert.equal(schema.allowed, expected, role + ' private schema');
      for (const fn of funcs) {
        const privilege = (await db.query('select has_function_privilege($1,$2,\'EXECUTE\') allowed', [role, 'public.' + fn])).rows[0];
        assert.equal(privilege.allowed, expected, role + ' ' + fn);
      }
      for (const table of ['pure_admin.login_requests', 'pure_admin.sessions']) {
        const privilege = (await db.query("select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') allowed", [role, table])).rows[0];
        assert.equal(privilege.allowed, expected, role + ' ' + table);
      }
    }
    const relations = (await db.query("select relrowsecurity from pg_class where oid in ('pure_admin.login_requests'::regclass,'pure_admin.sessions'::regclass)")).rows;
    assert.equal(relations.length, 2);
    assert.ok(relations.every(row => row.relrowsecurity));
    const security = (await db.query("select prosecdef from pg_proc where proname like 'pure_admin_%'")).rows;
    assert.equal(security.length, 4);
    assert.ok(security.every(row => row.prosecdef === false));
    for (const role of ['anon', 'authenticated']) {
      await db.exec('set role ' + role);
      await assert.rejects(db.query('select * from public.pure_admin_get_session($1,$2)', [digest('s'), digest('o')]), /permission denied/);
      await assert.rejects(db.query('select * from pure_admin.sessions'), /permission denied/);
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    const request = async (nonce, owner, ip) => (await db.query("select public.pure_admin_request_login($1,$2,$3,now()+interval '5 minutes') result", [digest(nonce), digest(owner), digest(ip)])).rows[0].result;
    const session = async (key, owner, nonce = null) => (await db.query("select public.pure_admin_create_session($1,$2,now()+interval '7 days',$3) result", [digest(key), digest(owner), nonce ? digest(nonce) : null])).rows[0].result;
    const read = async (key, owner) => (await db.query('select * from public.pure_admin_get_session($1,$2)', [digest(key), digest(owner)])).rows;

    assert.equal(await request('nonce-1', 'owner-1', 'ip-1'), 'created');
    assert.equal(await request('nonce-2', 'owner-1', 'other-ip'), 'rate_limited', 'recipient cooldown spans IPs');
    assert.equal(await session('session-wrong', 'wrong-owner', 'nonce-1'), false);
    assert.equal(await session('session-1', 'owner-1', 'nonce-1'), true);
    assert.equal(await session('session-2', 'owner-1', 'nonce-1'), false, 'consumed nonce cannot issue another session');
    assert.equal((await read('session-1', 'owner-1')).length, 1);
    assert.equal((await read('session-1', 'wrong-owner')).length, 0);

    assert.equal(await request('nonce-atomic', 'owner-atomic', 'ip-atomic'), 'created');
    await assert.rejects(session('session-1', 'owner-atomic', 'nonce-atomic'), /duplicate key/);
    const nonce = (await db.query('select consumed_at from pure_admin.login_requests where nonce_hash=$1', [digest('nonce-atomic')])).rows[0];
    assert.equal(nonce.consumed_at, null, 'failed session insert rolls nonce consumption back atomically');
    assert.equal(await session('session-atomic', 'owner-atomic', 'nonce-atomic'), true);

    await db.query('select public.pure_admin_revoke_session($1)', [digest('session-1')]);
    assert.equal((await read('session-1', 'owner-1')).length, 0);
    await db.query("insert into pure_admin.login_requests(nonce_hash,owner_hash,ip_hash,created_at,expires_at) values($1,$2,$3,now()-interval '20 minutes',now()-interval '10 minutes')", [digest('expired-nonce'), digest('expired-owner'), digest('expired-ip')]);
    assert.equal(await session('expired-link-session', 'expired-owner', 'expired-nonce'), false);
    await db.query("insert into pure_admin.sessions(session_hash,owner_hash,created_at,expires_at) values($1,$2,now()-interval '8 days',now()-interval '1 day')", [digest('expired-session'), digest('expired-owner')]);
    assert.equal((await read('expired-session', 'expired-owner')).length, 0);
    await assert.rejects(db.query("select public.pure_admin_create_session($1,$2,now()+interval '8 days',null)", [digest('too-long'), digest('owner')]), /Invalid admin session/);
    await assert.rejects(db.query("select public.pure_admin_request_login('plaintext-secret',$1,$2,now()+interval '5 minutes')", [digest('owner'), digest('ip')]), /Invalid sign-in request/);

    for (let i = 0; i < 5; i++) {
      await db.query("update pure_admin.login_requests set created_at=now()-interval '2 minutes' where owner_hash=$1", [digest('owner-limit')]);
      assert.equal(await request('owner-limit-' + i, 'owner-limit', 'unique-ip-' + i), 'created');
    }
    await db.query("update pure_admin.login_requests set created_at=now()-interval '2 minutes' where owner_hash=$1", [digest('owner-limit')]);
    assert.equal(await request('owner-limit-sixth', 'owner-limit', 'fresh-ip'), 'rate_limited', 'global recipient window caps sends');
    for (let i = 0; i < 3; i++) assert.equal(await request('ip-limit-' + i, 'unique-owner-' + i, 'ip-limit'), 'created');
    assert.equal(await request('ip-limit-fourth', 'another-owner', 'ip-limit'), 'rate_limited', 'IP window caps sends across owner keys');
  } finally { await db.close(); }
});
