(() => {
  'use strict';
  const endpoint = '/api/customer-config?admin_auth=session';
  const legacyKey = 'altapure_admin_password';
  const syncKey = 'pure_admin_session_change';
  const workspacePaths = new Set(['/admin-orders.html', '/admin-marketing.html']);
  let authenticated = false, csrf = '', expiresAt = '', readyPromise, pendingProof = '', generation = 0, initializing = false, authenticating = false;
  let passwordConfigured = null, linkError = '';

  // Remove credentials from the address bar before any asynchronous work or workspace requests.
  const fragment = new URLSearchParams(location.hash.slice(1));
  if (fragment.has('pure_admin_setup') || fragment.has('pure_admin')) {
    history.replaceState(null, '', location.pathname + location.search);
    const proofs = fragment.getAll('pure_admin_setup');
    if (proofs.length === 1 && !fragment.has('pure_admin') && /^v2\.[A-Za-z0-9_.-]+$/.test(proofs[0]) && proofs[0].length <= 180) {
      pendingProof = proofs[0];
    } else {
      linkError = 'This link cannot sign you in. Request a new password setup link below.';
    }
  }

  function clearLegacy() { try { sessionStorage.removeItem(legacyKey); } catch {} }
  function setState(value) {
    if (typeof value?.password_configured === 'boolean') passwordConfigured = value.password_configured;
    authenticated = value?.authenticated === true && typeof value.csrf_token === 'string';
    // A new session in another tab may follow setup; authenticated status omits the password flag.
    if (authenticated && passwordConfigured === false && typeof value.password_configured !== 'boolean') passwordConfigured = null;
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
    if (pendingProof || linkError) {
      // A setup link never signs in or sets a password merely by being opened.
      return false;
    }
    const ticket = ++generation, data = await request();
    if (ticket !== generation) return authenticated;
    if (setState(data)) { clearLegacy(); return true; }
    let previous = '';
    try { previous = sessionStorage.getItem(legacyKey) || ''; } catch {}
    if (!previous) return false;
    try {
      // Migrate the existing browser credential directly; never put it in a URL or UI.
      const data = await request({ action: 'bootstrap' }, { 'x-admin-password': previous });
      previous = ''; clearLegacy();
      if (ticket !== generation) return authenticated;
      setState(data); broadcast();
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
  async function requestSetup(returnTo) {
    const result = await request({ action: 'request_setup', return_to: returnTo === 'marketing' ? 'marketing' : 'orders' });
    pendingProof = ''; linkError = '';
    return result;
  }
  async function authenticate(body) {
    const ticket = ++generation;
    authenticating = true;
    try {
      const data = await request(body);
      if (ticket !== generation) return authenticated;
      pendingProof = ''; linkError = ''; passwordConfigured = true;
      setState(data); clearLegacy(); broadcast();
      readyPromise = Promise.resolve(authenticated);
      if (workspacePaths.has(data.return_to) && data.return_to !== location.pathname) location.replace(data.return_to);
      return authenticated;
    } catch (error) {
      if (body.action === 'set_password' && error.status === 401) pendingProof = '';
      throw error;
    } finally {
      authenticating = false;
    }
  }
  async function passwordLogin(password) {
    if (typeof password !== 'string' || !password || [...password].length > 128) throw new Error('Enter your admin password.');
    return authenticate({ action: 'password_login', password });
  }
  async function setPassword(password, confirmation) {
    if (!pendingProof) throw new Error('Request a new password setup link.');
    if (typeof password !== 'string' || [...password].length < 12 || [...password].length > 128) throw new Error('Use a password with 12 to 128 characters.');
    if (password !== confirmation) throw new Error('The passwords do not match. Enter the same password in both fields.');
    return authenticate({ action: 'set_password', token: pendingProof, password });
  }

  function bindForm({ form, heading, description, status, error, workspace, onAuthenticated }) {
    const password = form.querySelector('[data-admin-password]');
    const passwordLabel = form.querySelector('[data-admin-password-label]');
    const confirm = form.querySelector('[data-admin-password-confirm]');
    const confirmField = form.querySelector('[data-admin-confirm-field]');
    const hint = form.querySelector('[data-admin-password-hint]');
    const submit = form.querySelector('[type="submit"]');
    const setup = form.querySelector('[data-admin-request-setup]');
    const normalHeading = heading.textContent, normalDescription = description.textContent;
    let busy = true;
    function showError(message) { error.textContent = message; error.hidden = !message; }
    function render() {
      const creating = Boolean(pendingProof);
      heading.textContent = creating ? 'Set your admin password' : normalHeading;
      description.textContent = creating ? 'Choose one password for Orders and Marketing. After saving, this browser stays signed in for seven days.' : normalDescription;
      passwordLabel.textContent = creating ? 'New password' : 'Admin password';
      password.autocomplete = creating ? 'new-password' : 'current-password';
      confirmField.hidden = !creating; confirm.disabled = !creating || busy; confirm.required = creating;
      hint.hidden = !creating && passwordConfigured !== false;
      hint.textContent = creating ? 'Use 12–128 characters. Spaces and passphrases are welcome.' : 'Set up your admin password using the email link before signing in.';
      password.disabled = busy || (!creating && passwordConfigured === false);
      submit.disabled = busy || (!creating && passwordConfigured === false);
      submit.textContent = busy ? 'Please wait…' : creating ? 'Save password and enter' : 'Sign in';
      setup.disabled = busy;
      setup.textContent = creating ? 'Request a new setup link' : 'Set up / reset password';
      form.setAttribute('aria-busy', String(busy));
      if (!creating) confirm.value = '';
    }
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (busy) return;
      showError(''); status.hidden = true;
      const value = password.value, confirmation = confirm.value;
      busy = true; render();
      try {
        const signedIn = pendingProof ? await setPassword(value, confirmation) : await passwordLogin(value);
        if (signedIn && onAuthenticated) await onAuthenticated();
      } catch (failure) { showError(failure.message); }
      finally { password.value = ''; confirm.value = ''; busy = false; render(); }
    });
    setup.addEventListener('click', async () => {
      if (busy) return;
      busy = true; showError(''); status.hidden = true; render();
      try {
        const result = await requestSetup(workspace);
        status.textContent = result.message || 'A password setup link has been sent to your admin email. It expires in 30 minutes.';
        status.hidden = false;
      } catch (failure) { showError(failure.message); }
      finally { password.value = ''; confirm.value = ''; busy = false; render(); }
    });
    window.addEventListener('pure-admin-auth-change', render);
    render();
    ready().then(async signedIn => {
      if (linkError) showError(linkError);
      if (signedIn && onAuthenticated) await onAuthenticated();
    }).catch(failure => showError(failure.message)).finally(() => { busy = false; render(); });
    return Object.freeze({ render });
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
    pendingProof = ''; linkError = ''; clearLegacy(); setState({ authenticated: false });
    readyPromise = Promise.resolve(false); broadcast();
  }
  window.addEventListener('storage', event => {
    if (event.key === syncKey) refresh().catch(() => setState({ authenticated: false }));
  });
  window.addEventListener('focus', () => {
    if (readyPromise && !initializing && !authenticating && !pendingProof && !linkError) refresh().catch(() => setState({ authenticated: false }));
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted) { setState({ authenticated: false }); readyPromise = null; ready().catch(() => {}); }
  });
  window.PureAdminAuth = Object.freeze({
    ready, passwordLogin, requestSetup, setPassword, bindForm, fetch: adminFetch, logout, refresh,
    get authenticated() { return authenticated; },
    get pendingSetup() { return Boolean(pendingProof); },
    get passwordConfigured() { return passwordConfigured; },
    get expiresAt() { return expiresAt; }
  });
})();
