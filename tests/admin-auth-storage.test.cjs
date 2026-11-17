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

test('executed password storage limits guesses, isolates hashes, consumes reset once and revokes old sessions atomically', { skip: !PGlite, timeout: 60000 }, async () => {
  const db = new PGlite();
  const setupSql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261117204240_pure_admin_password_setup.sql'), 'utf8');
  const owner = digest('password-owner'), ip = digest('password-ip');
  const encoded = 'scrypt-v1$' + 'ab'.repeat(16) + '$' + 'cd'.repeat(64);
  const replacement = 'scrypt-v1$' + 'ef'.repeat(16) + '$' + '12'.repeat(64);
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls; alter default privileges in schema public grant execute on functions to anon,authenticated;');
    await db.exec(migration); await db.exec(setupSql);
    const signatures = [
      'pure_admin_password_status(text)','pure_admin_get_password(text)','pure_admin_password_attempt(text,text)',
      'pure_admin_request_password_setup(text,text,text,timestamptz)','pure_admin_password_setup_valid(text,text)',
      'pure_admin_create_password_session(text,text,timestamptz,text)','pure_admin_set_password(text,text,text,text,timestamptz)'
    ];
    for (const role of ['anon','authenticated','service_role']) {
      for (const fn of signatures) {
        const grant = (await db.query("select has_function_privilege($1,$2,'EXECUTE') allowed",[role,'public.'+fn])).rows[0];
        assert.equal(grant.allowed,role==='service_role',role+' '+fn);
      }
      for (const table of ['credentials','password_attempts']) {
        assert.equal((await db.query("select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') allowed",[role,'pure_admin.'+table])).rows[0].allowed,role==='service_role');
      }
    }
    assert.ok((await db.query("select relrowsecurity from pg_class where oid in ('pure_admin.credentials'::regclass,'pure_admin.password_attempts'::regclass)")).rows.every(r=>r.relrowsecurity));
    assert.ok((await db.query("select prosecdef from pg_proc where proname like 'pure_admin_%'")).rows.every(r=>!r.prosecdef));
    await db.exec('set role service_role');
    const request = async key => (await db.query("select public.pure_admin_request_password_setup($1,$2,$3,now()+interval '30 minutes') result",[digest(key),owner,ip])).rows[0].result;
    const set = async (key,hash,session) => (await db.query("select public.pure_admin_set_password($1,$2,$3,$4,now()+interval '7 days') result",[digest(key),owner,hash,digest(session)])).rows[0].result;
    const create = async (session,hash) => (await db.query("select public.pure_admin_create_password_session($1,$2,now()+interval '7 days',$3) result",[digest(session),owner,hash])).rows[0].result;
    const active = async session => (await db.query('select * from public.pure_admin_get_session($1,$2)',[digest(session),owner])).rows.length;
    assert.equal((await db.query('select public.pure_admin_password_status($1) configured',[owner])).rows[0].configured,false);
    assert.equal(await request('setup-1'),'created');
    assert.equal(await request('setup-2'),'rate_limited');
    assert.equal(await set('setup-1',encoded,'session-1'),true);
    assert.equal(await set('setup-1',replacement,'replay'),false);
    assert.equal((await db.query('select password_hash from public.pure_admin_get_password($1)',[owner])).rows[0].password_hash,encoded);
    assert.equal(await create('session-2',encoded),true);
    assert.equal(await create('bad-session',replacement),false);
    assert.equal(await active('session-1'),1);
    for (let i=0;i<10;i++) assert.equal((await db.query('select public.pure_admin_password_attempt($1,$2) allowed',[owner,ip])).rows[0].allowed,true);
    assert.equal((await db.query('select public.pure_admin_password_attempt($1,$2) allowed',[owner,digest('other-ip')])).rows[0].allowed,false);
    assert.equal((await db.query('select public.pure_admin_password_attempt($1,$2) allowed',[digest('other-owner'),ip])).rows[0].allowed,false);
    await db.query("update pure_admin.login_requests set created_at=now()-interval '2 minutes' where owner_hash=$1",[owner]);
    assert.equal(await request('setup-3'),'created');
    // A failure during session creation must roll back hash, revocations and nonce consumption.
    await assert.rejects(set('setup-3',replacement,'session-1'),/duplicate key/);
    assert.equal((await db.query('select password_hash from public.pure_admin_get_password($1)',[owner])).rows[0].password_hash,encoded);
    assert.equal(await active('session-1'),1);
    assert.equal(await set('setup-3',replacement,'session-3'),true);
    assert.equal(await active('session-1'),0);
    assert.equal(await active('session-2'),0);
    assert.equal(await active('session-3'),1);
    assert.equal(await create('stale-login',encoded),false,'login verified before reset cannot issue a stale session afterward');
    assert.equal(await create('current-login',replacement),true);
    assert.equal((await db.query('select count(*)::int n from pure_admin.password_attempts where owner_hash=$1',[owner])).rows[0].n,0);
    assert.equal((await db.query('select public.pure_admin_password_setup_valid($1,$2) valid',[digest('setup-3'),owner])).rows[0].valid,false);
    await db.query("insert into pure_admin.login_requests(nonce_hash,owner_hash,ip_hash,created_at,expires_at,purpose) values($1,$2,$3,now()-interval '40 minutes',now()-interval '10 minutes','password_setup')",[digest('expired'),owner,ip]);
    assert.equal(await set('expired',encoded,'expired-session'),false);
    await db.query("insert into pure_admin.login_requests(nonce_hash,owner_hash,ip_hash,expires_at,purpose) values($1,$2,$3,now()+interval '5 minutes','sign_in')",[digest('old-purpose'),owner,ip]);
    assert.equal(await set('old-purpose',encoded,'wrong-purpose-session'),false);
    await assert.rejects(set('missing','plaintext password','no-session'),/Invalid password setup/);
  } finally { await db.close(); }
});
