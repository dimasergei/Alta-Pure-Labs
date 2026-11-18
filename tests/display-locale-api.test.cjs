'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../config/display-currencies.json');
const locale = require('../lib/display-locale');
const fx = require('../lib/display-fx');
const api = require('../api/customer-config');
const now = Date.parse('2026-11-18T17:00:00.000Z');
const rows = () => fx.SUPPORTED_CURRENCIES.filter(quote => quote !== 'USD').map(quote => ({date: '2026-11-18', base: 'USD', quote, rate: quote === 'CAD' ? 1.43 : 2}));
function response() {
  return {code: 200, headers: {}, body: undefined, setHeader(key,value) {this.headers[key.toLowerCase()] = value;}, status(value) {this.code = value; return this;}, json(value) {this.body = value; return this;}, end() {return this;}};
}
async function call(query = 'display_locale=country', {method = 'GET', headers = {}, fetchImpl, time = now, body} = {}) {
  const res = response();
  await locale.handle({method, headers, body}, res, new URLSearchParams(query), {fetchImpl, now: time});
  return res;
}
function setEnvironment(values) {
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  for (const [key,value] of Object.entries(values)) process.env[key] = value;
  return () => {for (const [key,value] of Object.entries(previous)) {if (value === undefined) delete process.env[key]; else process.env[key] = value;}};
}

test('the display currency allowlist covers the verified ECB currencies without adding settlement currencies', () => {
  assert.deepEqual(config.supported_currencies, 'USD CAD EUR GBP AUD BRL CHF CNY CZK DKK HKD HUF IDR ILS INR ISK JPY KRW MXN MYR NOK NZD PHP PLN RON SEK SGD THB TRY ZAR'.split(' '));
  assert.equal(config.base, 'USD');
  const codes = config.country_codes.split(' ');
  assert.equal(new Set(codes).size, codes.length);
  for (const [country,currency] of Object.entries(config.country_currencies)) {
    assert.ok(codes.includes(country), country);
    assert.ok(config.supported_currencies.includes(currency), currency);
  }
});

test('coarse country hints use the Vercel header and map current euro-area and distinct European currencies correctly', async () => {
  const expected = {US:'USD',CA:'CAD',GB:'GBP',AU:'AUD',BG:'EUR',HR:'EUR',DE:'EUR',MC:'EUR',ME:'EUR',
    PL:'PLN',HU:'HUF',RO:'RON',DK:'DKK',SE:'SEK',CH:'CHF',LI:'CHF',JP:'JPY',KR:'KRW',NZ:'NZD',
    HK:'HKD',CN:'CNY',IN:'INR',MX:'MXN',BR:'BRL',AE:'USD',TZ:'USD'};
  for (const [country,currency] of Object.entries(expected)) {
    const res = await call(undefined, {headers: {'x-vercel-ip-country': country, 'x-forwarded-for': '192.0.2.10', 'x-vercel-ip-city': 'Sensitive city', cookie: 'private', authorization: 'Bearer fixture'}});
    assert.equal(res.code, 200);
    assert.equal(res.body.country, country);
    assert.equal(res.body.suggested_currency, currency);
    assert.equal(res.headers['cache-control'], 'private, no-store');
    assert.deepEqual(Object.keys(res.body).sort(), ['version','base','country','suggested_currency','supported_currencies'].sort());
  }
  assert.equal((await call(undefined, {headers: {'x-vercel-ip-country': 'ca'}})).body.suggested_currency, 'CAD');
});

test('missing, unknown and malformed country signals fall back to USD without IP, browser or address inference', async () => {
  for (const value of [undefined, null, '', 'XX', 'ZZ', 'QQ', 'EU', 'UK', 'USA', 'CA,US', ' CA', ['CA'], {}, 1]) {
    const res = await call(undefined, {headers: {'x-vercel-ip-country': value, 'cf-ipcountry':'CA', 'x-forwarded-for':'192.0.2.10', 'accept-language':'fr-CA'}, body: {address:{country:'CA'},country:'CA'}});
    assert.equal(res.body.country, null);
    assert.equal(res.body.suggested_currency, 'USD');
    assert.equal(res.headers['cache-control'], 'private, no-store');
  }
});

test('public rate responses and provider requests contain no account, location, payment or financial quote information', async () => {
  let calls = 0;
  const fetchImpl = async (url, options) => {
    calls++;
    assert.equal(url, fx.ENDPOINT);
    assert.deepEqual(options.headers, {Accept: 'application/json'});
    assert.deepEqual(Object.keys(options).sort(), ['headers','redirect','signal']);
    return new Response(JSON.stringify(rows()));
  };
  const first = await call('display_locale=rates', {headers: {'x-vercel-ip-country':'CA',authorization:'Bearer first',cookie:'first=private'}, fetchImpl});
  const second = await call('display_locale=rates', {headers: {'x-vercel-ip-country':'JP',authorization:'Bearer second',cookie:'second=private'}, fetchImpl});
  assert.deepEqual(first.body, second.body);
  assert.equal(first.body.status, 'fresh');
  assert.equal(first.headers['cache-control'], 'public, max-age=60, s-maxage=3600');
  assert.equal(first.headers['x-content-type-options'], 'nosniff');
  assert.equal(first.headers['set-cookie'], undefined);
  assert.equal(first.headers.vary, undefined);
  assert.equal(calls, 1);
  for (const key of ['country','customer','account','token','fx_quote','currency','total_cents','checkout_version','address']) assert.equal(Object.hasOwn(first.body,key), false);
});

test('outage and stale responses cannot be stored as normal fresh CDN rates', async () => {
  const failed = await call('display_locale=rates', {fetchImpl: async () => {throw Error('upstream outage');}});
  assert.equal(failed.code, 200);
  assert.equal(failed.body.status, 'unavailable');
  assert.deepEqual(failed.body.rates, {USD:1});
  assert.equal(failed.body.expires_at, null);
  assert.equal(failed.headers['cache-control'], 'no-store');
  let calls = 0;
  const fetchImpl = async () => {if (++calls > 1) throw Error('outage'); return new Response(JSON.stringify(rows()));};
  await call('display_locale=rates', {fetchImpl});
  const stale = await call('display_locale=rates', {fetchImpl, time: now + 3600000});
  assert.equal(stale.body.status, 'stale');
  assert.equal(stale.headers['cache-control'], 'no-store');
  assert.equal(Date.parse(stale.body.expires_at), now + 3660000);
});

test('read-only routes reject mutation methods and ambiguous or caller-controlled query parameters', async () => {
  let fetched = 0;
  const fetchImpl = async () => {fetched++; throw Error('Must not fetch');};
  for (const method of ['POST','PUT','PATCH','DELETE','HEAD','OPTIONS']) {
    const res = await call('display_locale=rates', {method, fetchImpl});
    assert.equal(res.code, 405);
    assert.equal(res.headers.allow, 'GET');
    assert.equal(res.headers['cache-control'], 'private, no-store');
  }
  for (const query of ['display_locale=', 'display_locale=unknown', 'display_locale=rates&display_locale=country',
    'display_locale=country&country=CA', 'display_locale=rates&base=CAD', 'display_locale=rates&url=https://untrusted.example',
    'display_locale=country&checkout=place']) {
    const res = await call(query, {fetchImpl});
    assert.equal(res.code, 400);
  }
  assert.equal(fetched, 0);
});

test('existing customer-config account JSON stays exact and does not fetch exchange rates', async t => {
  const restore = setEnvironment({SUPABASE_URL:'https://fixtureaccount.supabase.co',SUPABASE_ANON_KEY:'fixture-public-anon'});
  t.after(restore);
  t.mock.method(global, 'fetch', async () => {throw Error('Account config must not fetch rates');});
  const res = response();
  await api({method:'GET',url:'/api/customer-config',headers:{}},res);
  assert.equal(res.code,200);
  assert.deepEqual(res.body,{supabaseUrl:'https://fixtureaccount.supabase.co',anonKey:'fixture-public-anon'});
  assert.equal(res.headers['cache-control'],'no-store');
});

test('the existing dispatcher exposes locale before account setup and never routes it to inquiry or checkout mutations', async t => {
  const restore = setEnvironment({SUPABASE_URL:'',SUPABASE_ANON_KEY:'',SUPABASE_PUBLISHABLE_KEY:''});
  t.after(restore);
  t.mock.method(global, 'fetch', async () => {throw Error('No network is needed for country detection');});
  const res = response();
  await api({method:'GET',url:'/api/customer-config?display_locale=country',headers:{'x-vercel-ip-country':'CA'}},res);
  assert.equal(res.code,200);
  assert.equal(res.body.suggested_currency,'CAD');
  const noAccounts = response();
  await api({method:'GET',url:'/api/customer-config',headers:{}},noAccounts);
  assert.equal(noAccounts.code,503);
  assert.deepEqual(noAccounts.body,{error:'Customer accounts are not configured.'});
  const mutation = response();
  await api({method:'POST',url:'/api/customer-config?display_locale=country&checkout=place',headers:{},body:{total_cents:1}},mutation);
  assert.equal(mutation.code,405);
  assert.equal(mutation.headers.allow,'GET');
});
