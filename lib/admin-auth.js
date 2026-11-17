'use strict';

const { createHash, createHmac, randomBytes, timingSafeEqual } = require('node:crypto');
const { configuredOrigin, isAllowedOrigin } = require('./checkout-security');
const { emailSender } = require('./brand-display');
const { sendEmail } = require('./resend-email');

const COOKIE = '__Host-pure_admin';
const LINK_SECONDS = 10 * 60;
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const PATHS = Object.freeze({ orders: '/admin-orders.html', marketing: '/admin-marketing.html' });

function fail(status, message) { const error = new Error(message); error.status = status; throw error; }
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function equal(a, b) {
  return typeof a === 'string' && typeof b === 'string' && a.length <= 4096 && b.length <= 4096 &&
    timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}
function passwordMatches(provided, expected) {
  return typeof expected === 'string' && expected.length >= 32 && equal(provided, expected);
}
function signingKey(env) {
  const key = env.ADMIN_AUTH_SIGNING_SECRET || env.ADMIN_ORDERS_PASSWORD;
  if (typeof key !== 'string' || key.length < 32) fail(503, 'Admin sign-in is temporarily unavailable.');
  return createHmac('sha256', key).update('PURE admin authentication v1').digest();
}
function ownerMailbox(env) {
  const value = typeof env.ADMIN_ORDER_EMAIL === 'string' ? env.ADMIN_ORDER_EMAIL.trim() : '';
  // Only one plain mailbox is accepted. Never accept display names, lists or request input.
  if (value.length > 254 || /[\s,;<>\r\n]/.test(value)) fail(503, 'Admin sign-in is temporarily unavailable.');
  const parts = value.split('@');
  if (parts.length !== 2 || parts[0].length < 1 || parts[0].length > 64 ||
      !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(parts[0]) ||
      parts[0].startsWith('.') || parts[0].endsWith('.') || parts[0].includes('..') ||
      !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/.test(parts[1])) {
    fail(503, 'Admin sign-in is temporarily unavailable.');
  }
  return value.toLowerCase();
}
function ownerHash(env) { return createHmac('sha256', signingKey(env)).update('owner\n' + ownerMailbox(env)).digest('hex'); }
function csrfToken(token, env) { return createHmac('sha256', signingKey(env)).update('csrf\n' + token).digest('base64url'); }
function dbFor(deps) { return deps.db || require('./inventory-db').inventoryDb(); }
async function rpc(db, name, args) {
  const result = await db.rpc(name, args);
  if (result.error) fail(503, 'Admin authentication storage is temporarily unavailable.');
  return result.data;
}
function sessionCookie(req) {
  const header = req.headers?.cookie;
  if (typeof header !== 'string' || header.length > 16384) return null;
  const matches = header.split(';').map(v => v.trim()).filter(v => v.startsWith(COOKIE + '='));
  if (matches.length !== 1) return null;
  const token = matches[0].slice(COOKIE.length + 1);
  return TOKEN.test(token) ? token : null;
}
function requireOrigin(req, env) {
  if (req.headers?.['sec-fetch-site'] === 'cross-site' || !isAllowedOrigin(req.headers?.origin, env.SITE_URL)) {
    fail(403, 'Request origin not allowed.');
  }
}
function checkCookieRequest(req, token, env) {
  if (req.headers?.['sec-fetch-site'] === 'cross-site' ||
      (req.headers?.origin && !isAllowedOrigin(req.headers.origin, env.SITE_URL))) {
    fail(403, 'Request origin not allowed.');
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    requireOrigin(req, env);
    if (!equal(req.headers?.['x-pure-admin-csrf'], csrfToken(token, env))) fail(403, 'Admin request verification failed. Refresh and retry.');
  }
}
async function readSession(req, deps = {}) {
  const token = sessionCookie(req);
  if (!token) return null;
  const env = deps.env || process.env;
  checkCookieRequest(req, token, env);
  const value = await rpc(dbFor(deps), 'pure_admin_get_session', { p_session_hash: hash(token), p_owner_hash: ownerHash(env) });
  const row = Array.isArray(value) ? value[0] : value;
  if (!row?.expires_at || !Number.isFinite(Date.parse(row.expires_at)) || Date.parse(row.expires_at) <= (deps.now || Date.now)()) return null;
  return { token, expires_at: row.expires_at, csrf_token: csrfToken(token, env) };
}
async function assertAdmin(req, deps = {}) {
  const env = deps.env || process.env;
  if (passwordMatches(req.headers?.['x-admin-password'], env.ADMIN_ORDERS_PASSWORD)) return { method: 'legacy' };
  const session = await readSession(req, deps);
  if (!session) fail(401, 'Unauthorized.');
  return { method: 'session', ...session };
}
async function requireAdmin(req, res, deps = {}) {
  try { await assertAdmin(req, deps); return true; }
  catch (error) {
    const status = [401, 403, 503].includes(error.status) ? error.status : 503;
    res.status(status).json({ error: status === 503 ? 'Admin authentication is temporarily unavailable.' : error.message });
    return false;
  }
}
function makeLink(env, returnTo, now = Date.now(), nonce = randomBytes(32).toString('base64url')) {
  if (!Object.hasOwn(PATHS, returnTo) || !TOKEN.test(nonce)) fail(400, 'Choose an admin workspace.');
  const payload = ['v1', Math.floor(now / 1000), nonce, returnTo].join('.');
  const signature = createHmac('sha256', signingKey(env)).update('link\n' + payload + '\n' + ownerHash(env)).digest('base64url');
  return { token: payload + '.' + signature, nonce_hash: hash(nonce), return_to: PATHS[returnTo], expires_at: new Date(now + LINK_SECONDS * 1000).toISOString() };
}
function verifyLink(value, env, now = Date.now()) {
  if (typeof value !== 'string' || value.length > 180) fail(401, 'This sign-in link is invalid or expired. Request a new link.');
  const parts = value.split('.');
  if (parts.length !== 5 || parts[0] !== 'v1' || !/^\d{10}$/.test(parts[1]) ||
      !TOKEN.test(parts[2]) || !Object.hasOwn(PATHS, parts[3]) || !TOKEN.test(parts[4])) {
    fail(401, 'This sign-in link is invalid or expired. Request a new link.');
  }
  const issued = Number(parts[1]) * 1000;
  if (issued > now + 30000 || issued + LINK_SECONDS * 1000 <= now) fail(401, 'This sign-in link is invalid or expired. Request a new link.');
  const signature = createHmac('sha256', signingKey(env)).update('link\n' + parts.slice(0, 4).join('.') + '\n' + ownerHash(env)).digest('base64url');
  if (!equal(parts[4], signature)) fail(401, 'This sign-in link is invalid or expired. Request a new link.');
  return { nonce_hash: hash(parts[2]), return_to: PATHS[parts[3]] };
}
function setCookie(res, token, maxAge = SESSION_SECONDS) {
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; Max-Age=${maxAge}; Secure; HttpOnly; SameSite=Strict`);
}
function jsonBody(req) {
  if (String(req.headers?.['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') fail(415, 'JSON required.');
  const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
  if (Buffer.byteLength(raw, 'utf8') > 2048) fail(413, 'Sign-in request too large.');
  let body; try { body = JSON.parse(raw); } catch { fail(400, 'Invalid sign-in request.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'Invalid sign-in request.');
  return body;
}
async function createSession(res, env, db, now, nonceHash = null) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now + SESSION_SECONDS * 1000).toISOString();
  const accepted = await rpc(db, 'pure_admin_create_session', {
    p_session_hash: hash(token), p_owner_hash: ownerHash(env), p_expires_at: expiresAt, p_nonce_hash: nonceHash
  });
  if (accepted !== true) fail(401, 'This sign-in link has expired or was already used. Request a new link.');
  setCookie(res, token);
  return { authenticated: true, csrf_token: csrfToken(token, env), expires_at: expiresAt };
}
async function handle(req, res, deps = {}) {
  const env = deps.env || process.env, now = (deps.now || Date.now)();
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Vary', 'Cookie');
  try {
    if (req.method === 'GET') {
      const session = await readSession(req, deps);
      return res.status(200).json(session ? { authenticated: true, csrf_token: session.csrf_token, expires_at: session.expires_at } : { authenticated: false });
    }
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: 'Method not allowed.' }); }
    requireOrigin(req, env);
    const body = jsonBody(req);
    if (body.action === 'logout') {
      const token = sessionCookie(req);
      if (token) {
        checkCookieRequest(req, token, env);
        await rpc(dbFor(deps), 'pure_admin_revoke_session', { p_session_hash: hash(token) });
      }
      setCookie(res, '', 0);
      return res.status(200).json({ authenticated: false });
    }
    if (body.action === 'bootstrap') {
      if (!passwordMatches(req.headers?.['x-admin-password'], env.ADMIN_ORDERS_PASSWORD)) fail(401, 'Unauthorized.');
      return res.status(200).json(await createSession(res, env, dbFor(deps), now));
    }
    if (body.action === 'exchange') {
      const proof = verifyLink(body.token, env, now);
      return res.status(200).json({ ...await createSession(res, env, dbFor(deps), now, proof.nonce_hash), return_to: proof.return_to });
    }
    if (body.action !== 'request_link') fail(400, 'Unknown sign-in action.');
    const recipient = ownerMailbox(env);
    if (typeof env.RESEND_API_KEY !== 'string' || !env.RESEND_API_KEY.trim() ||
        typeof env.ORDER_CONFIRMATION_FROM !== 'string' || !env.ORDER_CONFIRMATION_FROM.trim()) {
      fail(503, 'Admin sign-in email is temporarily unavailable.');
    }
    const link = makeLink(env, body.return_to || 'orders', now);
    const address = String(req.headers?.['x-vercel-forwarded-for'] || req.headers?.['x-real-ip'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim().slice(0, 100);
    const result = await rpc(dbFor(deps), 'pure_admin_request_login', {
      p_nonce_hash: link.nonce_hash, p_owner_hash: ownerHash(env), p_ip_hash: createHmac('sha256', signingKey(env)).update('ip\n' + address).digest('hex'), p_expires_at: link.expires_at
    });
    if (result !== 'created') fail(429, 'Please wait before requesting another sign-in link.');
    const configured = configuredOrigin(env.SITE_URL);
    const origin = ['https://getpurelabs.com', 'https://altapurelabs.com'].includes(configured) ? 'https://getpurelabs.com' : configured;
    const url = origin + link.return_to + '#pure_admin=' + encodeURIComponent(link.token);
    await (deps.sendEmail || sendEmail)({
      from: emailSender(env.ORDER_CONFIRMATION_FROM), to: [recipient], subject: 'Your PURE admin sign-in link',
      text: `Sign in to PURE Admin:\n\n${url}\n\nThis link expires in 10 minutes and can be used once. If you did not request it, you can ignore this email.`,
      html: `<div style="font-family:Arial,sans-serif;color:#111;max-width:520px;margin:auto;padding:32px"><h1 style="font-size:32px;letter-spacing:-1px">PURE</h1><h2>Sign in to your admin workspace</h2><p>This link expires in 10 minutes and can be used once.</p><p style="margin:28px 0"><a href="${url}" style="display:inline-block;background:#111;color:#fff;padding:14px 22px;text-decoration:none;font-weight:700">SIGN IN TO PURE ADMIN</a></p><p>If you did not request this email, you can ignore it.</p></div>`
    }, { env, fetchImpl: deps.fetchImpl || fetch, idempotencyKey: 'pure-admin-login/' + link.nonce_hash });
    return res.status(202).json({ requested: true, message: 'A sign-in link has been sent to the configured owner inbox. It expires in 10 minutes.' });
  } catch (error) {
    const status = [400, 401, 403, 413, 415, 429, 503].includes(error.status) ? error.status : 503;
    return res.status(status).json({ error: status === 503 ? 'Admin sign-in is temporarily unavailable. Please try again.' : error.message });
  }
}

module.exports = { handle, assertAdmin, requireAdmin, passwordMatches, makeLink, verifyLink, ownerMailbox, ownerHash, COOKIE, LINK_SECONDS, SESSION_SECONDS };
