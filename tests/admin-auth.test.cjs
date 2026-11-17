'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const auth = require('../lib/admin-auth');
const env = {
  SITE_URL: 'https://getpurelabs.com', ADMIN_ORDERS_PASSWORD: 'legacy-admin-secret-'.repeat(3),
  ADMIN_AUTH_SIGNING_SECRET: 'dedicated-admin-signing-secret-'.repeat(3),
  ADMIN_ORDER_EMAIL: 'owner@example.test', RESEND_API_KEY: 'test-only-resend-key',
  ORDER_CONFIRMATION_FROM: 'PURE <orders@example.test>'
};
const hash = value => createHash('sha256').update(value).digest('hex');
function response() { return { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.statusCode = n; return this; }, json(value) { this.body = value; return this; } }; }
function request(body, headers = {}) {
  return { method: body ? 'POST' : 'GET', url: '/api/customer-config?admin_auth=session',
    headers: { origin: env.SITE_URL, 'sec-fetch-site': 'same-origin', ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body };
}
function store(now) {
  const requests = new Map(), sessions = new Map(), credentials = new Map(), calls = [];
  return { requests, sessions, credentials, calls, limited: false, async rpc(name, p) {
    calls.push({ name, p });
    if (name === 'pure_admin_request_password_setup') {
      if (this.limited) return { data: 'rate_limited' };
      requests.set(p.p_nonce_hash, { owner: p.p_owner_hash, expires: p.p_expires_at, consumed: false });
      return { data: 'created' };
    }
    if (name === 'pure_admin_password_status') return { data: credentials.has(p.p_owner_hash) };
    if (name === 'pure_admin_get_password') return { data: credentials.has(p.p_owner_hash) ? [{ password_hash: credentials.get(p.p_owner_hash) }] : [] };
    if (name === 'pure_admin_password_attempt') return { data: !this.limited };
    if (name === 'pure_admin_password_setup_valid') {
      const r = requests.get(p.p_nonce_hash);
      return { data: Boolean(r && !r.consumed && r.owner === p.p_owner_hash && Date.parse(r.expires) > now()) };
    }
    if (name === 'pure_admin_set_password') {
      const r = requests.get(p.p_nonce_hash);
      if (!r || r.consumed || r.owner !== p.p_owner_hash || Date.parse(r.expires) <= now()) return { data: false };
      credentials.set(p.p_owner_hash, p.p_password_hash);
      for (const record of requests.values()) if (record.owner === p.p_owner_hash) record.consumed = true;
      for (const session of sessions.values()) if (session.owner === p.p_owner_hash) session.revoked = true;
      sessions.set(p.p_session_hash, { owner: p.p_owner_hash, expires_at: p.p_expires_at, revoked: false });
      return { data: true };
    }
    if (name === 'pure_admin_create_password_session') {
      if (credentials.get(p.p_owner_hash) !== p.p_password_hash) return { data: false };
      sessions.set(p.p_session_hash, { owner: p.p_owner_hash, expires_at: p.p_expires_at, revoked: false });
      return { data: true };
    }
    if (name === 'pure_admin_create_session') {
      if (p.p_nonce_hash) {
        const r = requests.get(p.p_nonce_hash);
        if (!r || r.consumed || r.owner !== p.p_owner_hash || Date.parse(r.expires) <= now()) return { data: false };
        r.consumed = true;
      }
      sessions.set(p.p_session_hash, { owner: p.p_owner_hash, expires_at: p.p_expires_at, revoked: false });
      return { data: true };
    }
    if (name === 'pure_admin_get_session') {
      const s = sessions.get(p.p_session_hash);
      return { data: s && !s.revoked && s.owner === p.p_owner_hash && Date.parse(s.expires_at) > now() ? [{ expires_at: s.expires_at }] : [] };
    }
    if (name === 'pure_admin_revoke_session') { const s = sessions.get(p.p_session_hash); if (s) s.revoked = true; return { data: true }; }
    throw Error('Unexpected RPC: ' + name);
  } };
}
function setup() {
  let time = Date.parse('2026-11-17T12:00:00Z');
  const now = () => time, db = store(now), mail = [];
  const deps = { env, db, now, sendEmail: async (message, options) => { mail.push({ message, options }); return { id: 'test-email' }; } };
  return { db, mail, deps, advance(ms) { time += ms; }, async call(body, headers) { const res = response(); await auth.handle(request(body, headers), res, deps); return res; } };
}
async function bootstrap(ctx) {
  const res = await ctx.call({ action: 'bootstrap' }, { 'x-admin-password': env.ADMIN_ORDERS_PASSWORD });
  assert.equal(res.statusCode, 200);
  return { res, cookie: res.headers['Set-Cookie'].split(';')[0], csrf: res.body.csrf_token };
}

test('owner password setup link is sent only by the explicit action, only to the server mailbox, with no recipient/proof disclosure', async () => {
  const ctx = setup();
  const status = await ctx.call();
  assert.deepEqual(status.body, { authenticated: false, password_configured: false });
  assert.equal(ctx.mail.length, 0);
  const sent = await ctx.call({ action: 'request_setup', return_to: 'marketing', email: 'attacker@example.test' });
  assert.equal(sent.statusCode, 202);
  assert.equal(ctx.mail.length, 1);
  assert.deepEqual(ctx.mail[0].message.to, ['owner@example.test']);
  assert.doesNotMatch(JSON.stringify(sent.body), /owner@example|pure_admin_setup=|v2\./);
  const link = ctx.mail[0].message.text.match(/https:\/\/[^\s]+/)[0];
  assert.equal(new URL(link).pathname, '/admin-marketing.html');
  assert.equal(new URL(link).search, '');
  const token = new URLSearchParams(new URL(link).hash.slice(1)).get('pure_admin_setup');
  const proof = auth.verifyLink(token, env, ctx.deps.now());
  assert.ok(ctx.db.requests.has(proof.nonce_hash));
  assert.doesNotMatch(JSON.stringify([...ctx.db.requests]), new RegExp(token.replaceAll('.', '\\.')));
});

test('mailbox lists, display names, malformed mailboxes and arbitrary return URLs fail closed', async () => {
  for (const email of ['', 'a@example.test,b@example.test', 'Owner <owner@example.test>', 'owner@example.test\r\nBcc:other@example.test', 'a..b@example.test', 'a@-bad.example']) {
    assert.throws(() => auth.ownerMailbox({ ...env, ADMIN_ORDER_EMAIL: email }), /unavailable/);
  }
  const ctx = setup();
  for (const return_to of ['https://evil.example/', '//evil.example', '/admin-orders.html', '__proto__']) {
    const res = await ctx.call({ action: 'request_setup', return_to });
    assert.equal(res.statusCode, 400);
  }
  assert.equal(ctx.mail.length, 0);
});

test('signed links reject tampering, expiry, future issue times, another owner, and another signing key', () => {
  const now = Date.parse('2026-11-17T12:00:00Z');
  const link = auth.makeLink(env, 'orders', now);
  assert.equal(auth.verifyLink(link.token, env, now).return_to, '/admin-orders.html');
  for (const token of [link.token.replace('.orders.', '.marketing.'), link.token.slice(0, -1) + (link.token.endsWith('A') ? 'B' : 'A'), 'x'.repeat(4096)]) {
    assert.throws(() => auth.verifyLink(token, env, now), /invalid or expired/);
  }
  assert.throws(() => auth.verifyLink(link.token, env, now + auth.LINK_SECONDS * 1000), /invalid or expired/);
  assert.throws(() => auth.verifyLink(link.token, env, now - 31000), /invalid or expired/);
  assert.throws(() => auth.verifyLink(link.token, { ...env, ADMIN_ORDER_EMAIL: 'other@example.test' }, now), /invalid or expired/);
  assert.throws(() => auth.verifyLink(link.token, { ...env, ADMIN_AUTH_SIGNING_SECRET: 'changed-secret-'.repeat(4) }, now), /invalid or expired/);
});

test('one-time password setup consumes the server nonce, rejects replay and issues only a hashed opaque secure session', async () => {
  const ctx = setup();
  await ctx.call({ action: 'request_setup', return_to: 'orders' });
  const url = new URL(ctx.mail[0].message.text.match(/https:\/\/[^\s]+/)[0]);
  const token = new URLSearchParams(url.hash.slice(1)).get('pure_admin_setup');
  const [a, b] = await Promise.all([ctx.call({ action: 'set_password', token, password: 'correct horse battery staple' }), ctx.call({ action: 'set_password', token, password: 'correct horse battery staple' })]);
  assert.deepEqual([a.statusCode, b.statusCode].sort(), [200, 401]);
  const ok = a.statusCode === 200 ? a : b;
  assert.match(ok.headers['Set-Cookie'], /^__Host-pure_admin=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=604800; Secure; HttpOnly; SameSite=Strict$/);
  assert.equal(ok.body.return_to, '/admin-orders.html');
  const cookieToken = ok.headers['Set-Cookie'].split(';')[0].split('=')[1];
  assert.ok(ctx.db.sessions.has(hash(cookieToken)));
  assert.equal(ctx.db.sessions.size, 1);
  assert.ok(!JSON.stringify(ok.body).includes(cookieToken));
  assert.equal((await ctx.call({ action: 'set_password', token, password: 'correct horse battery staple' })).statusCode, 401);
  assert.equal(ctx.mail.length, 1);
});

test('valid legacy header remains supported without cookie/owner settings; invalid or short credentials remain rejected', async () => {
  let touched = false;
  const deps = { env: { ADMIN_ORDERS_PASSWORD: env.ADMIN_ORDERS_PASSWORD }, db: { rpc() { touched = true; throw Error('Unexpected database call'); } } };
  assert.equal((await auth.assertAdmin(request({}, { 'x-admin-password': env.ADMIN_ORDERS_PASSWORD }), deps)).method, 'legacy');
  assert.equal(touched, false);
  await assert.rejects(auth.assertAdmin(request({}, { 'x-admin-password': 'wrong' }), deps), { status: 401 });
  assert.equal(auth.passwordMatches('short', 'short'), false);
  const ctx = setup();
  const session = await bootstrap(ctx);
  assert.equal(session.res.body.authenticated, true);
  assert.equal(ctx.mail.length, 0);
});

test('session GET verifies server state, grants both dashboards, and requires origin plus CSRF for mutations', async () => {
  const ctx = setup(), { cookie, csrf } = await bootstrap(ctx);
  const status = await ctx.call(undefined, { cookie });
  assert.equal(status.body.authenticated, true);
  assert.equal(status.body.csrf_token, csrf);
  for (const url of ['/api/admin-orders', '/api/customer-config?marketing=admin']) {
    const req = { ...request(undefined, { cookie }), url };
    assert.equal((await auth.assertAdmin(req, ctx.deps)).method, 'session');
  }
  for (const method of ['POST', 'PATCH', 'DELETE']) {
    await assert.rejects(auth.assertAdmin({ ...request({}, { cookie }), method }, ctx.deps), { status: 403 });
    await assert.rejects(auth.assertAdmin({ ...request({}, { cookie, 'x-pure-admin-csrf': csrf, origin: 'https://evil.example' }), method }, ctx.deps), { status: 403 });
    assert.equal((await auth.assertAdmin({ ...request({}, { cookie, 'x-pure-admin-csrf': csrf }), method }, ctx.deps)).method, 'session');
  }
  await assert.rejects(auth.assertAdmin(request(undefined, { cookie, 'sec-fetch-site': 'cross-site' }), ctx.deps), { status: 403 });
  const crossSiteRequest = await ctx.call({ action: 'request_setup' }, { origin: 'https://evil.example' });
  assert.equal(crossSiteRequest.statusCode, 403);
  assert.equal(ctx.mail.length, 0);
});

test('logout revokes the shared session; expiry and owner/signing-key changes also deny access', async () => {
  const ctx = setup(), { cookie, csrf } = await bootstrap(ctx);
  assert.equal((await ctx.call({ action: 'logout' }, { cookie })).statusCode, 403);
  assert.equal((await ctx.call(undefined, { cookie })).body.authenticated, true);
  const done = await ctx.call({ action: 'logout' }, { cookie, 'x-pure-admin-csrf': csrf });
  assert.equal(done.statusCode, 200);
  assert.match(done.headers['Set-Cookie'], /Max-Age=0/);
  await assert.rejects(auth.assertAdmin(request(undefined, { cookie }), ctx.deps), { status: 401 });
  const next = await bootstrap(ctx);
  for (const changes of [{ ADMIN_ORDER_EMAIL: 'other@example.test' }, { ADMIN_AUTH_SIGNING_SECRET: 'new-signing-secret-'.repeat(4) }]) {
    await assert.rejects(auth.assertAdmin(request(undefined, { cookie: next.cookie }), { ...ctx.deps, env: { ...env, ...changes } }), { status: 401 });
  }
  ctx.advance(auth.SESSION_SECONDS * 1000 + 1);
  assert.equal((await ctx.call(undefined, { cookie: next.cookie })).body.authenticated, false);
});

test('rate-limit and storage failures never send an email or expose a token', async () => {
  const ctx = setup(); ctx.db.limited = true;
  assert.equal((await ctx.call({ action: 'request_setup' })).statusCode, 429);
  assert.equal(ctx.mail.length, 0);
  ctx.db.rpc = async () => ({ error: { message: 'private storage detail' } });
  const res = await ctx.call({ action: 'request_setup' });
  assert.equal(res.statusCode, 503);
  assert.doesNotMatch(JSON.stringify(res.body), /private storage detail|owner@example/);
  assert.equal(ctx.mail.length, 0);
});

test('new admin links use the PURE domain even when the legacy production alias is configured', async () => {
  const ctx = setup(); ctx.deps.env = { ...env, SITE_URL: 'https://altapurelabs.com' };
  const result = await ctx.call({ action: 'request_setup', return_to: 'orders' });
  assert.equal(result.statusCode, 202);
  assert.match(ctx.mail[0].message.text, /https:\/\/getpurelabs\.com\/admin-orders\.html#pure_admin_setup=/);
  assert.doesNotMatch(ctx.mail[0].message.text, /https:\/\/altapurelabs\.com/);
});

test('Resend transport refuses redirects and bounds provider response bodies', async () => {
  const { sendEmail } = require('../lib/resend-email');
  let observed;
  const ok = await sendEmail({ to: ['test@example.test'], subject: 'Synthetic test only' }, {
    env, fetchImpl: async (url, options) => { observed = { url, options }; return new Response(JSON.stringify({ id: 'mock-provider-id' }), { status: 200 }); }
  });
  assert.equal(ok.id, 'mock-provider-id');
  assert.equal(observed.url, 'https://api.resend.com/emails');
  assert.equal(observed.options.redirect, 'error');
  await assert.rejects(sendEmail({}, { env, fetchImpl: async () => new Response('x'.repeat(20000), { status: 200 }) }), /unavailable/);
  await assert.rejects(sendEmail({}, { env, fetchImpl: async () => new Response('{}', { status: 302, headers: { location: 'https://evil.example' } }) }), /unavailable/);
});

test('all existing admin API entrypoints still refuse unauthenticated access', async () => {
  const previous = process.env.ADMIN_ORDERS_PASSWORD;
  process.env.ADMIN_ORDERS_PASSWORD = env.ADMIN_ORDERS_PASSWORD;
  const noDb = { rpc() { throw Error('Unauthenticated DB access'); }, from() { throw Error('Unauthenticated DB access'); } };
  try {
    for (const file of ['admin-orders','admin-suppliers','admin-supplier-batches','admin-supplier-batch-pdf','admin-notifications','admin-notification-retry']) {
      const res = response();
      await require('../api/' + file)({ method: 'GET', url: '/api/' + file, headers: {} }, res);
      assert.equal(res.statusCode, 401, file);
    }
    const cases = [
      ['admin-operations','admin_operations=requests'], ['lotus-admin','lotus=admin'],
      ['direct-checkout','checkout=admin'], ['multi-payment-commerce','commerce=admin&view=methods'],
      ['manual-commerce-integrated','commerce=admin&view=automation'], ['manual-commerce','commerce=admin'],
      ['native-gateway','native=admin'], ['partner-program','partner=admin']
    ];
    for (const [name, query] of cases) {
      const res = response();
      await require('../lib/' + name).handle({ method: 'GET', headers: {}, url: '/api/customer-config?' + query }, res, new URLSearchParams(query), { env, db: noDb });
      assert.equal(res.statusCode, 401, name);
    }
    const marketing = response();
    await require('../lib/admin-marketing')({ method: 'GET', headers: {} }, marketing, { env, db: noDb });
    assert.equal(marketing.statusCode, 401);
    const research = response();
    await require('../lib/research-builder-handler')({ method: 'GET', headers: {}, query: { scope: 'admin' } }, research);
    assert.equal(research.statusCode, 401);
  } finally {
    if (previous === undefined) delete process.env.ADMIN_ORDERS_PASSWORD;
    else process.env.ADMIN_ORDERS_PASSWORD = previous;
  }
});

test('authentication storage uses private RLS tables and service-role-only invoker functions', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261117192716_pure_passwordless_admin_sessions.sql'), 'utf8');
  assert.match(sql, /alter table pure_admin\.login_requests enable row level security/);
  assert.match(sql, /alter table pure_admin\.sessions enable row level security/);
  assert.doesNotMatch(sql, /security definer/i);
  for (const fn of ['request_login','create_session','get_session','revoke_session']) {
    assert.match(sql, new RegExp('revoke all on function public\\.pure_admin_' + fn + '[^;]+from public, anon, authenticated'));
    assert.match(sql, new RegExp('grant execute on function public\\.pure_admin_' + fn + '[^;]+to service_role'));
  }
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /consumed_at is null and expires_at > now\(\)/);
});

async function setupPassword(ctx, password = 'correct horse battery staple') {
  const requested = await ctx.call({ action: 'request_setup' });
  assert.equal(requested.statusCode, 202);
  const url = new URL(ctx.mail.at(-1).message.text.match(/https:\/\/[^\s]+/)[0]);
  const token = new URLSearchParams(url.hash.slice(1)).get('pure_admin_setup');
  return { token, response: await ctx.call({ action: 'set_password', token, password }) };
}

test('password setup recipient uses the server admin email override and never request data', async () => {
  const ctx = setup(); ctx.deps.env = { ...env, ADMIN_AUTH_EMAIL: 'dimasrgh@gmail.com' };
  const sent = await ctx.call({ action: 'request_setup', email: 'attacker@example.test', recipient: 'attacker@example.test' });
  assert.equal(sent.statusCode, 202);
  assert.deepEqual(ctx.mail[0].message.to, ['dimasrgh@gmail.com']);
  assert.equal(ctx.mail[0].message.subject, 'Set your PURE admin password');
  assert.match(ctx.mail[0].message.text, /30 minutes/);
  assert.doesNotMatch(JSON.stringify(sent.body), /dimasrgh|attacker|v2\./);
  for (const action of ['exchange', 'request_link']) {
    assert.equal((await ctx.call({ action, token: 'old-sign-in-proof' })).statusCode, 400);
  }
});

test('chosen password signs in without email, rejects wrong passwords, and reset revokes existing sessions', async () => {
  const ctx = setup();
  const initial = await setupPassword(ctx);
  assert.equal(initial.response.statusCode, 200);
  assert.equal((await ctx.call()).body.password_configured, true);
  const oldCookie = initial.response.headers['Set-Cookie'].split(';')[0];
  const encoded = [...ctx.db.credentials.values()][0];
  assert.match(encoded, /^scrypt-v1\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
  assert.doesNotMatch(JSON.stringify(initial.response.body), /scrypt|battery|password_hash/);
  const signed = await ctx.call({ action: 'password_login', password: 'correct horse battery staple' });
  assert.equal(signed.statusCode, 200);
  assert.equal(ctx.mail.length, 1, 'routine password login sends no email');
  assert.equal((await ctx.call({ action: 'password_login', password: 'wrong password' })).statusCode, 401);
  ctx.db.limited = true;
  assert.equal((await ctx.call({ action: 'password_login', password: 'correct horse battery staple' })).statusCode, 429);
  ctx.db.limited = false;
  const reset = await setupPassword(ctx, 'another long password phrase');
  assert.equal(reset.response.statusCode, 200);
  assert.equal((await ctx.call(undefined, { cookie: oldCookie })).body.authenticated, false);
  assert.equal((await ctx.call({ action: 'password_login', password: 'correct horse battery staple' })).statusCode, 401);
  assert.equal((await ctx.call({ action: 'password_login', password: 'another long password phrase' })).statusCode, 200);
});

test('password setup enforces length and explicit new password before consuming its proof', async () => {
  const ctx = setup();
  const start = await setupPassword(ctx, 'short');
  assert.equal(start.response.statusCode, 400);
  assert.equal(ctx.db.credentials.size, 0);
  assert.equal((await ctx.call({ action: 'set_password', token: start.token })).statusCode, 400);
  assert.equal((await ctx.call({ action: 'set_password', token: start.token, password: 'x'.repeat(129) })).statusCode, 400);
  assert.equal((await ctx.call({ action: 'set_password', token: start.token, password: 'twelve words and café 🔬' })).statusCode, 200);
  assert.equal((await ctx.call({ action: 'password_login', password: 'twelve words and café 🔬' })).statusCode, 200);
  assert.equal((await ctx.call({ action: 'password_login', password: 'twelve words and cafe 🔬' })).statusCode, 401);
});

test('a concurrent reset after password verification cannot mint a session from the stale hash', async () => {
  const ctx = setup(); await setupPassword(ctx);
  const original = ctx.db.rpc.bind(ctx.db);
  ctx.db.rpc = async (name, p) => {
    if (name === 'pure_admin_create_password_session') return { data: false };
    return original(name, p);
  };
  const result = await ctx.call({ action: 'password_login', password: 'correct horse battery staple' });
  assert.equal(result.statusCode, 401);
  assert.ok(!result.headers['Set-Cookie']);
});
