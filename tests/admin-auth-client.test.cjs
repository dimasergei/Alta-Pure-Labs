'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, CookieJar } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '../admin-auth.js'), 'utf8');
const legacy = 'browser-existing-admin-secret-'.repeat(2);
const settle = () => new Promise(resolve => setImmediate(resolve));
function server() {
  const jar = new CookieJar(), calls = [], sessions = new Map(); let issued = 0;
  const json = (status, body) => ({ ok: status >= 200 && status < 300, status, async json() { return body; } });
  const api = { jar, calls, sessions, pendingStatus: null, deferStatus: false,
    async fetch(window, input, options = {}) {
      const url = new URL(input, window.location.href), headers = new Headers(options.headers || {});
      const body = options.body ? JSON.parse(options.body) : null;
      calls.push({ path: url.pathname + url.search, method: options.method || 'GET', headers, body });
      const cookie = jar.getCookieStringSync(url.href).match(/(?:^|; )__Host-pure_admin=([^;]+)/)?.[1];
      const session = cookie && sessions.get(cookie);
      if (!url.searchParams.has('admin_auth')) {
        if (!session) return json(401, { error: 'Unauthorized.' });
        if (options.method && options.method !== 'GET' && headers.get('x-pure-admin-csrf') !== session.csrf) return json(403, { error: 'Missing CSRF' });
        return json(200, { ok: true });
      }
      if (!body) {
        const result = json(200, session ? { authenticated: true, csrf_token: session.csrf, expires_at: '2026-11-24T12:00:00Z' } : { authenticated: false });
        if (api.deferStatus) { api.deferStatus = false; return new Promise(resolve => { api.pendingStatus = () => resolve(result); }); }
        return result;
      }
      if (body.action === 'request_link') return json(202, { requested: true, message: 'Check the owner inbox.' });
      if (body.action === 'bootstrap' || body.action === 'exchange') {
        if (body.action === 'bootstrap' && headers.get('x-admin-password') !== legacy) return json(401, { error: 'Unauthorized.' });
        const token = 'test-session-' + (++issued), csrf = 'csrf-' + issued;
        sessions.set(token, { csrf });
        jar.setCookieSync(`__Host-pure_admin=${token}; Path=/; Secure; HttpOnly; SameSite=Strict`, url.href);
        return json(200, { authenticated: true, csrf_token: csrf, expires_at: '2026-11-24T12:00:00Z', ...(body.action === 'exchange' ? { return_to: url.pathname.includes('marketing') ? '/admin-marketing.html' : window.location.pathname } : {}) });
      }
      if (body.action === 'logout') {
        if (session && headers.get('x-pure-admin-csrf') !== session.csrf) return json(403, { error: 'Missing CSRF' });
        if (cookie) sessions.delete(cookie);
        jar.setCookieSync('__Host-pure_admin=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict', url.href);
        return json(200, { authenticated: false });
      }
      return json(400, { error: 'Unexpected test action' });
    }
  };
  return api;
}
function browser(api, page, fragment = '') {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://getpurelabs.com/' + page + fragment, runScripts: 'outside-only', cookieJar: api.jar });
  dom.window.Headers = Headers;
  dom.window.fetch = (url, options) => api.fetch(dom.window, url, options);
  dom.window.eval(source);
  return dom;
}

test('an existing browser password migrates once, is cleared, and one HttpOnly session authorizes both admin pages', async () => {
  const api = server(), orders = browser(api, 'admin-orders.html'), marketing = browser(api, 'admin-marketing.html');
  try {
    orders.window.sessionStorage.setItem('altapure_admin_password', legacy);
    assert.equal(await orders.window.PureAdminAuth.ready(), true);
    assert.equal(orders.window.sessionStorage.getItem('altapure_admin_password'), null);
    assert.equal(await marketing.window.PureAdminAuth.ready(), true);
    assert.equal(api.calls.filter(c => c.body?.action === 'bootstrap').length, 1);
    assert.equal(api.calls.filter(c => c.body?.action === 'request_link').length, 0);
    assert.ok(!orders.window.document.cookie.includes('__Host-pure_admin'));
    assert.equal((await orders.window.PureAdminAuth.fetch('/api/admin-orders')).status, 200);
    assert.equal((await marketing.window.PureAdminAuth.fetch('/api/customer-config?marketing=admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 200);
    const protectedCall = api.calls.at(-1);
    assert.equal(protectedCall.headers.get('x-pure-admin-csrf'), 'csrf-1');
    assert.equal(protectedCall.headers.has('x-admin-password'), false);
    assert.ok(!orders.window.location.href.includes(legacy));
    await assert.rejects(orders.window.PureAdminAuth.fetch('https://evil.example/api'), /must stay on this site/);
  } finally { orders.window.close(); marketing.window.close(); }
});

test('a link proof is scrubbed immediately and never consumed or emailed until a deliberate action', async () => {
  const api = server(), dom = browser(api, 'admin-orders.html', '#pure_admin=one-time-test-proof');
  try {
    assert.equal(await dom.window.PureAdminAuth.ready(), false);
    assert.equal(dom.window.location.hash, '');
    assert.equal(dom.window.PureAdminAuth.pendingLink, true);
    assert.equal(api.calls.length, 0, 'even a JavaScript mail scanner does not exchange the proof');
    assert.equal(await dom.window.PureAdminAuth.completeLink(), true);
    assert.equal(dom.window.PureAdminAuth.pendingLink, false);
    assert.equal(api.calls.filter(c => c.body?.action === 'exchange').length, 1);
    assert.equal(api.calls.filter(c => c.body?.action === 'request_link').length, 0);
    assert.ok(!dom.window.sessionStorage.getItem('pure_admin'));
  } finally { dom.window.close(); }
});

test('cross-tab sign-in unlocks an already open second workspace and logout locks it again', async () => {
  const api = server(), orders = browser(api, 'admin-orders.html'), marketing = browser(api, 'admin-marketing.html');
  try {
    assert.equal(await marketing.window.PureAdminAuth.ready(), false);
    const events = [];
    marketing.window.addEventListener('pure-admin-auth-change', event => events.push(event.detail.authenticated));
    orders.window.sessionStorage.setItem('altapure_admin_password', legacy);
    await orders.window.PureAdminAuth.ready();
    marketing.window.dispatchEvent(new marketing.window.StorageEvent('storage', { key: 'pure_admin_session_change', newValue: '1' }));
    await settle();
    assert.equal(marketing.window.PureAdminAuth.authenticated, true);
    assert.equal(await marketing.window.PureAdminAuth.ready(), true);
    assert.ok(events.includes(true));
    await orders.window.PureAdminAuth.logout();
    marketing.window.dispatchEvent(new marketing.window.StorageEvent('storage', { key: 'pure_admin_session_change', newValue: '2' }));
    await settle();
    assert.equal(marketing.window.PureAdminAuth.authenticated, false);
    assert.equal(events.at(-1), false);
    await assert.rejects(marketing.window.PureAdminAuth.fetch('/api/customer-config?marketing=admin'), /Sign in/);
  } finally { orders.window.close(); marketing.window.close(); }
});

test('a delayed pre-logout status response cannot restore a revoked client session', async () => {
  const api = server(), dom = browser(api, 'admin-orders.html');
  try {
    dom.window.sessionStorage.setItem('altapure_admin_password', legacy);
    await dom.window.PureAdminAuth.ready();
    api.deferStatus = true;
    const pending = dom.window.PureAdminAuth.refresh();
    await settle();
    await dom.window.PureAdminAuth.logout();
    api.pendingStatus();
    await pending;
    assert.equal(dom.window.PureAdminAuth.authenticated, false);
    assert.equal(await dom.window.PureAdminAuth.ready(), false);
  } finally { dom.window.close(); }
});

test('the two dashboards load shared auth before their clients and expose no password field', () => {
  for (const page of ['admin-orders.html', 'admin-marketing.html']) {
    const html = fs.readFileSync(path.join(__dirname, '..', page), 'utf8');
    assert.doesNotMatch(html, /type="password"|id="(?:admin|mk)-password"/);
    assert.match(html, /Send sign-in link/);
    assert.ok(html.includes('/admin-auth.js'));
    assert.ok(html.indexOf('/admin-auth.js') < html.indexOf(page === 'admin-orders.html' ? '/admin-fulfillment.js' : '/admin-marketing.js'));
  }
  const orders = fs.readFileSync(path.join(__dirname, '../admin-orders.html'), 'utf8');
  const marketing = fs.readFileSync(path.join(__dirname, '../admin-marketing.js'), 'utf8');
  assert.match(orders, /else if \(ordersView\.hidden\) openAdminWorkspace/);
  assert.match(marketing, /else if\(!loggedIn\)login\(\)/);
});
