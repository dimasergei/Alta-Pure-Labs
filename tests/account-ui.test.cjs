const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const read = (path) => readFileSync(resolve(__dirname, "..", path), "utf8");

test("storefront header orders Search, Account, then Cart", () => {
  const html = read("index.html");
  const search = html.indexOf('id="open-search"');
  const account = html.indexOf('href="/account" aria-label="Account"');
  const cart = html.indexOf('id="open-cart"');
  assert.ok(search >= 0 && account > search && cart > account);
  assert.match(html.slice(account, cart), /<svg[\s\S]*?<circle cx="12" cy="8"/);
});

test("order detail shipping address uses real line breaks, not literal backslash-n", () => {
  const account = read("account.js");
  assert.ok(account.includes(".filter(Boolean).join('\\n')"));
  assert.ok(!account.includes(".filter(Boolean).join('\\\\n')"));
});

test("account navigation exposes the requested sections in order", () => {
  const account = read("account.js");
  const start = account.indexOf("function accountNav(active)");
  const end = account.indexOf("async function overview()", start);
  assert.ok(start >= 0 && end > start);
  const nav = account.slice(start, end);
  const labels = ["Overview", "Membership", "Subscriptions", "Points", "Store Credit", "Orders", "Profile", "Partner", "Log out"];
  let previous = -1;
  for (const label of labels) {
    const next = nav.indexOf(label);
    assert.ok(next > previous, `Navigation item out of order: ${label}`);
    previous = next;
  }
});

test("profile editing updates only the authenticated user's display name", () => {
  const account = read("account.js");
  assert.match(account, /auth\.auth\.updateUser\(\{data:\{\.\.\.\(user\.user_metadata\|\|\{\}\),full_name:value\}\}\)/);
  assert.match(account, /readonly aria-readonly="true"/);
  assert.doesNotMatch(account, /updateUser\(\{email:/);
});

test("Google sign-in is present on account, login, and signup routes", () => {
  const account = read("account.js");
  assert.match(account, /function googleOption\(\)[\s\S]*?Continue with Google/);
  assert.match(account, /function bindGoogle\(\)[\s\S]*?provider:'google'/);
  assert.match(account, /redirectTo:'https:\/\/altapurelabs\.com\/account'/);
  assert.match(account, /function login\(error=''\)[\s\S]*?googleOption\(\)[\s\S]*?bindGoogle\(\)/);
  assert.match(account, /function signup\(error=''\)[\s\S]*?googleOption\(\)[\s\S]*?bindGoogle\(\)/);
  assert.match(account, /head\('Your account'[\s\S]*?googleOption\(\)[\s\S]*?bindGoogle\(\)/);
});
