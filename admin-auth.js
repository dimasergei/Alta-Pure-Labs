(() => {
  'use strict';
  const endpoint = '/api/customer-config?admin_auth=session';
  const legacyKey = 'altapure_admin_password';
  const syncKey = 'pure_admin_session_change';
  const workspacePaths = new Set(['/admin-orders.html', '/admin-marketing.html']);
  let authenticated = false, csrf = '', expiresAt = '', readyPromise, pendingProof = '', generation = 0, initializing = false;

  function clearLegacy() { try { sessionStorage.removeItem(legacyKey); } catch {} }
  function setState(value) {
    authenticated = value?.authenticated === true && typeof value.csrf_token === 'string';
    csrf = authenticated ? value.csrf_token : '';
    expiresAt = authenticated ? value.expires_at || '' : '';
    window.dispatchEvent(new CustomEvent('pure-admin-auth-change', { detail: { authenticated } }));
    return authenticated;
  }
  function broadcast() { try { localStorage.setItem(syncKey, String(Date.now())); } catch {} }
  async function request(body, headers = {}) {
    const response = await fetch(endpoint, {
      method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(csrf ? { 'x-pure-admin-csrf': csrf } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || 'Admin sign-in is temporarily unavailable.');
      error.status = response.status;
      throw error;
    }
    return data;
  }
  async function refresh() {
    const ticket = ++generation, data = await request();
    if (ticket !== generation) return authenticated;
    const result = setState(data); readyPromise = Promise.resolve(result); return result;
  }
  async function initialize() {
    const fragment = new URLSearchParams(location.hash.slice(1));
    const link = fragment.get('pure_admin');
    if (link !== null) {
      // A login proof is never retained in history, server requests or referrers.
      history.replaceState(null, '', location.pathname + location.search);
      if (!link || link.length > 180) throw new Error('This sign-in link is invalid. Request a new link.');
      pendingProof = link;
      // Even scanners that execute JavaScript cannot consume a link without a click.
      return false;
    }
    if (setState(await request())) { clearLegacy(); return true; }
    let previous = '';
    try { previous = sessionStorage.getItem(legacyKey) || ''; } catch {}
    if (!previous) return false;
    try {
      // Migrate the existing browser credential directly; never put it in a URL or UI.
      const data = await request({ action: 'bootstrap' }, { 'x-admin-password': previous });
      previous = ''; clearLegacy(); setState(data); broadcast();
      return authenticated;
    } catch (error) {
      previous = '';
      if (error.status === 401) { clearLegacy(); return false; }
      throw error;
    }
  }
  function ready() {
    if (!readyPromise) {
      initializing = true;
      readyPromise = initialize().catch(error => { readyPromise = null; throw error; }).finally(() => { initializing = false; });
    }
    return readyPromise;
  }
  async function requestLink(returnTo) {
    return request({ action: 'request_link', return_to: returnTo === 'marketing' ? 'marketing' : 'orders' });
  }
  async function completeLink() {
    if (!pendingProof) throw new Error('Request a new sign-in link.');
    ++generation;
    try {
      const data = await request({ action: 'exchange', token: pendingProof });
      pendingProof = ''; setState(data); clearLegacy(); broadcast();
      readyPromise = Promise.resolve(authenticated);
      if (workspacePaths.has(data.return_to) && data.return_to !== location.pathname) location.replace(data.return_to);
      return authenticated;
    } catch (error) {
      if (error.status === 401) pendingProof = '';
      throw error;
    }
  }
  async function adminFetch(url, options = {}) {
    await ready();
    if (!authenticated) { const error = new Error('Sign in to your admin workspace.'); error.status = 401; throw error; }
    const target = new URL(url, location.href);
    if (target.origin !== location.origin) throw new Error('Admin requests must stay on this site.');
    const headers = new Headers(options.headers || {});
    headers.delete('x-admin-password');
    if (!['GET', 'HEAD', 'OPTIONS'].includes((options.method || 'GET').toUpperCase())) headers.set('x-pure-admin-csrf', csrf);
    const response = await fetch(target.href, { ...options, headers, credentials: 'same-origin', cache: 'no-store' });
    if (response.status === 401) setState({ authenticated: false });
    return response;
  }
  async function logout() {
    ++generation;
    await request({ action: 'logout' });
    ++generation;
    pendingProof = ''; clearLegacy(); setState({ authenticated: false });
    readyPromise = Promise.resolve(false); broadcast();
  }
  window.addEventListener('storage', event => {
    if (event.key === syncKey) refresh().catch(() => setState({ authenticated: false }));
  });
  window.addEventListener('focus', () => {
    if (readyPromise && !initializing && !pendingProof) refresh().catch(() => setState({ authenticated: false }));
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted) { setState({ authenticated: false }); readyPromise = null; ready().catch(() => {}); }
  });
  window.PureAdminAuth = Object.freeze({
    ready, requestLink, completeLink, fetch: adminFetch, logout, refresh,
    get authenticated() { return authenticated; },
    get pendingLink() { return Boolean(pendingProof); },
    get expiresAt() { return expiresAt; }
  });
})();
