const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');

test('storefront build emits the Stripe checkout interceptor and preserves Live-mode server validation', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'altapure-checkout-build-'));

  try {
    for (const file of ['index.html', 'products.js', 'install-store.cjs', 'checkout.js']) {
      fs.copyFileSync(path.join(projectRoot, file), path.join(tempRoot, file));
    }

    const build = spawnSync(process.execPath, ['install-store.cjs'], {
      cwd: tempRoot,
      encoding: 'utf8'
    });

    assert.equal(build.status, 0, `build failed:\n${build.stdout}\n${build.stderr}`);

    const builtHtml = fs.readFileSync(path.join(tempRoot, 'index.html'), 'utf8');
    const builtCheckoutPath = path.join(tempRoot, 'checkout.js');
    assert.match(builtHtml, /<script src="\/checkout\.js"><\/script>/);
    assert.ok(fs.existsSync(builtCheckoutPath), 'checkout.js must be present beside the built HTML');

    const interceptor = fs.readFileSync(builtCheckoutPath, 'utf8');
    assert.match(interceptor, /form\.addEventListener\('submit'/);
    assert.match(interceptor, /event\.stopImmediatePropagation\(\)/);
    assert.match(interceptor, /fetch\('\/api\/checkout'/);
    assert.match(builtHtml, /Continue to secure checkout/);

    const checkoutCopy = builtHtml + '\n' + interceptor;
    assert.doesNotMatch(checkoutCopy, /Test checkout only|Test mode only|secure test checkout/i);

    const backend = fs.readFileSync(path.join(projectRoot, 'lib', 'backend.js'), 'utf8');
    assert.match(backend, /LIVE_CHECKOUT_ENABLED\s*===\s*'true'/);
    assert.match(backend, /key\.startsWith\('sk_live_'\)/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
