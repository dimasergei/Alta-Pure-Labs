'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, CookieJar } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '../admin-auth.js'), 'utf8');
const legacy = 'browser-existing-admin-secret-'.repeat(2);
const passphrase = 'a calm admin passphrase 🪷';
const setupToken = 'v2.1794916800.' + 'a'.repeat(43) + '.orders.' + 'b'.repeat(43);
const settle = () => new Promise(resolve => setImmediate(resolve));
function server() {
  const jar = new CookieJar(), calls = [], sessions = new Map(); let issued = 0;
  const json = (status, body) => ({ ok: status >= 200 && status < 300, status, async json() { return body; } });
  const api = { jar, calls, sessions, passwordConfigured: false, password: passphrase, setupUsed: false, pendingStatus: null, deferStatus: false,
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
        const result = json(200, session ? { authenticated: true, csrf_token: session.csrf, expires_at: '2026-11-24T12:00:00Z' } : { authenticated: false, password_configured: api.passwordConfigured });
        if (api.deferStatus) { api.deferStatus = false; return new Promise(resolve => { api.pendingStatus = () => resolve(result); }); }
        return result;
      }
      if (body.action === 'request_setup') return json(202, { requested: true, message: 'A password setup link has been sent to your admin email. It expires in 30 minutes.' });
      if (['bootstrap', 'password_login', 'set_password'].includes(body.action)) {
        if (body.action === 'bootstrap' && headers.get('x-admin-password') !== legacy) return json(401, { error: 'Unauthorized.' });
        if (body.action === 'password_login' && (!api.passwordConfigured || body.password !== api.password)) return json(401, { error: 'Incorrect admin password.' });
        if (body.action === 'set_password') {
          if (body.token !== setupToken || api.setupUsed) return json(401, { error: 'This password setup link has expired or has already been used. Request a new link.' });
          api.setupUsed = true; api.password = body.password; api.passwordConfigured = true; sessions.clear();
        }
        const token = 'test-session-' + (++issued), csrf = 'csrf-' + issued;
        sessions.set(token, { csrf });
        jar.setCookieSync(`__Host-pure_admin=${token}; Path=/; Secure; HttpOnly; SameSite=Strict`, url.href);
        return json(200, { authenticated: true, csrf_token: csrf, expires_at: '2026-11-24T12:00:00Z', ...(body.action === 'set_password' ? { return_to: window.location.pathname } : {}) });
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
function browser(api, page, fragment = '', actualMarkup = false) {
  const html = actualMarkup ? fs.readFileSync(path.join(__dirname, '..', page), 'utf8') : '<!doctype html><html><body></body></html>';
  const dom = new JSDOM(html, { url: 'https://getpurelabs.com/' + page + fragment, runScripts: 'outside-only', cookieJar: api.jar });
  dom.window.Headers = Headers;
  dom.window.fetch = (url, options) => api.fetch(dom.window, url, options);
  dom.window.eval(source);
  return dom;
}
function bindDashboard(dom, workspace) {
  const prefix = workspace === 'marketing' ? 'mk-' : '', doc = dom.window.document;
  const options = {
    form: doc.getElementById(prefix + 'login-form'), heading: doc.getElementById(prefix + 'login-heading'),
    description: doc.getElementById(prefix + 'login-description'), status: doc.getElementById(prefix + 'login-status'),
    error: doc.getElementById(prefix + 'login-error'), workspace, opened: 0,
    async onAuthenticated() { options.opened++; }
  };
  dom.window.PureAdminAuth.bindForm(options);
  return {
    ...options, options,
    password: options.form.querySelector('[data-admin-password]'),
    confirm: options.form.querySelector('[data-admin-password-confirm]'),
    confirmField: options.form.querySelector('[data-admin-confirm-field]'),
    setup: options.form.querySelector('[data-admin-request-setup]'),
    submit: options.form.querySelector('[type="submit"]'),
    send() { options.form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); }
  };
}

test('an existing browser password migrates once, is cleared, and one HttpOnly session authorizes both admin pages', async () => {
  const api = server(), orders = browser(api, 'admin-orders.html'), marketing = browser(api, 'admin-marketing.html');
  try {
    orders.window.sessionStorage.setItem('altapure_admin_password', legacy);
    assert.equal(await orders.window.PureAdminAuth.ready(), true);
    assert.equal(orders.window.sessionStorage.getItem('altapure_admin_password'), null);
    assert.equal(await marketing.window.PureAdminAuth.ready(), true);
    assert.equal(api.calls.filter(c => c.body?.action === 'bootstrap').length, 1);
    assert.equal(api.calls.filter(c => c.body?.action === 'request_setup').length, 0);
    assert.ok(!orders.window.document.cookie.includes('__Host-pure_admin'));
    assert.equal((await orders.window.PureAdminAuth.fetch('/api/admin-orders')).status, 200);
    assert.equal((await marketing.window.PureAdminAuth.fetch('/api/customer-config?marketing=admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 200);
    assert.equal(api.calls.at(-1).headers.get('x-pure-admin-csrf'), 'csrf-1');
    assert.equal(api.calls.at(-1).headers.has('x-admin-password'), false);
    assert.ok(!orders.window.location.href.includes(legacy));
    await assert.rejects(orders.window.PureAdminAuth.fetch('https://evil.example/api'), /must stay on this site/);
  } finally { orders.window.close(); marketing.window.close(); }
});

test('a setup proof is scrubbed synchronously and opening it neither signs in nor requests mail', async () => {
  const api = server(), dom = browser(api, 'admin-orders.html', '#pure_admin_setup=' + setupToken);
  try {
    assert.equal(dom.window.location.hash, '', 'scrub before ready or any network request');
    assert.equal(await dom.window.PureAdminAuth.ready(), false);
    assert.equal(dom.window.PureAdminAuth.pendingSetup, true);
    dom.window.dispatchEvent(new dom.window.Event('focus'));
    await settle();
    assert.equal(api.calls.length, 0, 'a mail scanner cannot consume the proof');
    await assert.rejects(dom.window.PureAdminAuth.setPassword('short', 'short'), /12 to 128/);
    await assert.rejects(dom.window.PureAdminAuth.setPassword(passphrase, passphrase + '!'), /do not match/);
    await assert.rejects(dom.window.PureAdminAuth.setPassword('🔐'.repeat(129), '🔐'.repeat(129)), /12 to 128/);
    assert.equal(api.calls.length, 0);
    const unicodePassword = '🔐'.repeat(12);
    assert.equal(await dom.window.PureAdminAuth.setPassword(unicodePassword, unicodePassword), true);
    assert.equal(dom.window.PureAdminAuth.pendingSetup, false);
    assert.deepEqual(api.calls[0].body, { action: 'set_password', token: setupToken, password: unicodePassword });
    assert.equal(api.calls.filter(c => c.body?.action === 'request_setup').length, 0);
    assert.equal(dom.window.sessionStorage.length, 0);
    assert.doesNotMatch(JSON.stringify(dom.window.localStorage), /v2\.|🔐/);
  } finally { dom.window.close(); }
});

test('legacy, duplicated and invalid fragments never grant access and offer a deliberate fresh setup request', async () => {
  for (const hash of ['#pure_admin=old-v1-proof', '#pure_admin_setup=v1.old', '#pure_admin_setup=' + setupToken + '&pure_admin_setup=' + setupToken]) {
    const api = server(), dom = browser(api, 'admin-orders.html', hash, true);
    try {
      const form = bindDashboard(dom, 'orders');
      await settle();
      assert.equal(dom.window.location.hash, '');
      assert.equal(dom.window.PureAdminAuth.pendingSetup, false);
      assert.equal(dom.window.PureAdminAuth.authenticated, false);
      assert.equal(api.calls.length, 0);
      assert.match(form.error.textContent, /Request a new password setup link/);
      form.setup.click(); await settle();
      assert.deepEqual(api.calls[0].body, { action: 'request_setup', return_to: 'orders' });
      assert.equal(form.status.hidden, false);
      assert.doesNotMatch(form.status.textContent, /@/);
    } finally { dom.window.close(); }
  }
});

test('both actual dashboard forms request setup only after a click and use the correct workspace', async () => {
  for (const workspace of ['orders', 'marketing']) {
    const api = server(), dom = browser(api, 'admin-' + workspace + '.html', '', true);
    try {
      const form = bindDashboard(dom, workspace);
      await settle();
      assert.equal(dom.window.PureAdminAuth.passwordConfigured, false);
      assert.equal(api.calls.length, 1);
      assert.equal(api.calls[0].method, 'GET');
      assert.equal(form.submit.disabled, true);
      assert.equal(form.password.disabled, true);
      assert.equal(form.confirmField.hidden, true);
      assert.equal(form.confirm.disabled, true);
      assert.equal(form.setup.disabled, false);
      form.setup.click(); await settle();
      assert.deepEqual(api.calls.at(-1).body, { action: 'request_setup', return_to: workspace });
      assert.match(form.status.textContent, /expires in 30 minutes/);
      assert.equal(form.options.opened, 0);
      assert.equal(dom.window.PureAdminAuth.authenticated, false);
    } finally { dom.window.close(); }
  }
});

test('both dashboard password forms reject mistakes, clear passwords, then sign in without sending email', async () => {
  for (const workspace of ['orders', 'marketing']) {
    const api = server(); api.passwordConfigured = true;
    const dom = browser(api, 'admin-' + workspace + '.html', '', true);
    try {
      const form = bindDashboard(dom, workspace);
      await settle();
      assert.equal(form.password.autocomplete, 'current-password');
      assert.equal(form.submit.disabled, false);
      form.password.value = 'mistyped password'; form.send(); await settle();
      assert.equal(form.password.value, '');
      assert.match(form.error.textContent, /Incorrect admin password/);
      assert.equal(form.options.opened, 0);
      form.password.value = passphrase; form.send(); await settle();
      assert.equal(dom.window.PureAdminAuth.authenticated, true);
      assert.equal(form.password.value, '');
      assert.equal(form.error.hidden, true);
      assert.equal(form.options.opened, 1);
      assert.equal(api.calls.filter(c => c.body?.action === 'request_setup').length, 0);
      assert.equal(api.calls.at(-1).body.password, passphrase);
      assert.equal(dom.window.sessionStorage.length, 0);
    } finally { dom.window.close(); }
  }
});

test('setup forms require matching new passwords and submit the one-time proof only with a password', async () => {
  const api = server(), dom = browser(api, 'admin-marketing.html', '#pure_admin_setup=' + setupToken, true);
  try {
    const form = bindDashboard(dom, 'marketing'); await settle();
    assert.equal(form.password.autocomplete, 'new-password');
    assert.equal(form.confirmField.hidden, false);
    assert.equal(form.confirm.required, true);
    assert.equal(form.submit.textContent, 'Save password and enter');
    assert.equal(api.calls.length, 0);
    form.password.value = passphrase; form.confirm.value = 'a different passphrase'; form.send(); await settle();
    assert.match(form.error.textContent, /do not match/);
    assert.equal(api.calls.length, 0);
    assert.equal(form.password.value, '');
    assert.equal(form.confirm.value, '');
    form.password.value = passphrase; form.confirm.value = passphrase; form.send(); form.send(); await settle();
    assert.equal(api.calls.filter(c => c.body?.action === 'set_password').length, 1, 'double-submit cannot consume a proof twice');
    assert.equal(form.options.opened, 1);
    assert.equal(form.password.value, '');
    assert.equal(form.confirm.value, '');
  } finally { dom.window.close(); }
});

test('an expired setup proof shows its error and lets the user request a replacement', async () => {
  const api = server(); api.setupUsed = true;
  const dom = browser(api, 'admin-orders.html', '#pure_admin_setup=' + setupToken, true);
  try {
    const form = bindDashboard(dom, 'orders'); await settle();
    form.password.value = passphrase; form.confirm.value = passphrase; form.send(); await settle();
    assert.equal(dom.window.PureAdminAuth.pendingSetup, false);
    assert.match(form.error.textContent, /expired or has already been used/);
    assert.equal(form.confirmField.hidden, true);
    assert.equal(form.options.opened, 0);
    form.setup.click(); await settle();
    assert.equal(api.calls.at(-1).body.action, 'request_setup');
    assert.equal(form.status.hidden, false);
  } finally { dom.window.close(); }
});

test('cross-tab password sign-in unlocks an already open second workspace and logout locks it again', async () => {
  const api = server(); api.passwordConfigured = true;
  const orders = browser(api, 'admin-orders.html'), marketing = browser(api, 'admin-marketing.html');
  try {
    assert.equal(await marketing.window.PureAdminAuth.ready(), false);
    const events = [];
    marketing.window.addEventListener('pure-admin-auth-change', event => events.push(event.detail.authenticated));
    await orders.window.PureAdminAuth.ready();
    await orders.window.PureAdminAuth.passwordLogin(passphrase);
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

test('a tab opened before password setup can still use the password form after a shared-session logout', async () => {
  const api = server(), marketing = browser(api, 'admin-marketing.html', '', true);
  const orders = browser(api, 'admin-orders.html', '#pure_admin_setup=' + setupToken);
  try {
    const form = bindDashboard(marketing, 'marketing'); await settle();
    assert.equal(form.submit.disabled, true);
    await orders.window.PureAdminAuth.ready();
    await orders.window.PureAdminAuth.setPassword(passphrase, passphrase);
    marketing.window.dispatchEvent(new marketing.window.StorageEvent('storage', { key: 'pure_admin_session_change', newValue: 'setup-complete' }));
    await settle();
    assert.equal(marketing.window.PureAdminAuth.authenticated, true);
    await marketing.window.PureAdminAuth.logout();
    assert.equal(form.password.disabled, false);
    assert.equal(form.submit.disabled, false);
    form.password.value = passphrase; form.send(); await settle();
    assert.equal(marketing.window.PureAdminAuth.authenticated, true);
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

test('both dashboards load shared authentication before their clients without exposing an owner email', () => {
  for (const page of ['admin-orders.html', 'admin-marketing.html']) {
    const html = fs.readFileSync(path.join(__dirname, '..', page), 'utf8');
    assert.match(html, /type="password" autocomplete="current-password"/);
    assert.match(html, /data-admin-request-setup type="button"/);
    assert.doesNotMatch(html, /Send sign-in link|dimasrgh@gmail\.com|#pure_admin=/);
    assert.ok(html.indexOf('/admin-auth.js') < html.indexOf(page === 'admin-orders.html' ? '/admin-fulfillment.js' : '/admin-marketing.js'));
  }
  const orders = fs.readFileSync(path.join(__dirname, '../admin-orders.html'), 'utf8');
  const marketing = fs.readFileSync(path.join(__dirname, '../admin-marketing.js'), 'utf8');
  assert.match(orders, /else if \(ordersView\.hidden\) openAdminWorkspace/);
  assert.match(marketing, /else if\(!loggedIn\)login\(\)/);
  assert.match(orders, /Contact: support@getpurelabs\.com/);
  assert.match(marketing, /PURE\\nsupport@getpurelabs\.com/);
});
