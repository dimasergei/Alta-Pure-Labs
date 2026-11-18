'use strict';

// Policy content stays static; the shared storefront scripts only power the
// surrounding navigation, search and cart. The policy main intentionally has
// its own ID so the storefront router never replaces the document.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');

const policyFiles = [
  'shipping-policy.html',
  'shipping-protection.html',
  'refund-policy.html',
  'privacy-policy.html',
  'terms-and-conditions.html',
  'research-use-policy.html',
  'commercial-terms.html',
  'corrections-policy.html',
  'medical-disclaimer.html',
  'research-documentation.html',
  'partner-terms.html',
  'membership-terms.html'
];

const sharedScriptNames = new Set([
  'storefront-navigation.js', 'products.js', 'product-images.js', 'locale.js',
  'storefront-v2.js', 'cart-nmi-express.js', 'cart-reference.js'
]);

function textFragments(root) {
  const walker = root.ownerDocument.createTreeWalker(root, 4);
  const values = [];
  let node;
  while ((node = walker.nextNode())) {
    const value = node.textContent.replace(/\s+/g, ' ').trim();
    if (value) values.push(value);
  }
  return values.sort();
}

module.exports = function buildPolicyLayout(outputDirectory) {
  const shellDOM = new JSDOM(fs.readFileSync(path.join(outputDirectory, 'index.html'), 'utf8'));
  const shell = shellDOM.window.document;
  const headerNodes = ['.ap-skip', '.ap-announcement', '.ap-header'].map(selector => {
    const node = shell.querySelector(selector);
    if (!node) throw Error('Shared PURE policy shell is missing ' + selector);
    return node;
  });
  const footer = shell.querySelector('.ap-footer');
  if (!footer) throw Error('Shared PURE policy shell is missing its footer');
  const controls = ['#ap-search-dialog', '#ap-cart-dialog', '#ap-compare-dialog', '#ap-toast', '#ap-compare-bar']
    .map(selector => shell.querySelector(selector)).filter(Boolean);
  const styles = [...shell.querySelectorAll('link[rel="stylesheet"]')];
  const scripts = [...shell.querySelectorAll('script[src]')].filter(script => {
    const source = script.getAttribute('src').split('?')[0];
    return source.startsWith('/') && sharedScriptNames.has(path.posix.basename(source));
  });
  for (const required of ['storefront-navigation.js', 'products.js', 'storefront-v2.js', 'cart-reference.js']) {
    assert.ok(scripts.some(script => path.posix.basename(script.getAttribute('src').split('?')[0]) === required), 'Missing shared policy script: ' + required);
  }

  fs.copyFileSync(path.join(__dirname, 'pure-policy.css'), path.join(outputDirectory, 'pure-policy.css'));
  let count = 0;
  for (const file of policyFiles) {
    const target = path.join(outputDirectory, file);
    if (!fs.existsSync(target)) continue;
    const dom = new JSDOM(fs.readFileSync(target, 'utf8'));
    const document = dom.window.document;
    const main = document.querySelector('main');
    if (!main || !main.querySelector('h1')) throw Error('Policy content is missing: ' + file);

    // Repeated builds can refresh the shared shell without duplicating wrappers.
    main.querySelectorAll('[data-pure-policy-label]').forEach(node => node.remove());
    const contentBefore = textFragments(main);
    const linksBefore = [...main.querySelectorAll('a[href]')].map(a => [a.textContent.trim(), a.getAttribute('href')]);
    main.querySelectorAll('.wrap, .pure-policy-content').forEach(node => node.replaceWith(...node.childNodes));
    main.querySelectorAll('[style]').forEach(node => node.removeAttribute('style'));
    main.querySelectorAll('.ap-container, .ap-page-intro, .ap-editorial, .ap-panel, .ap-guide').forEach(node => {
      if (node.classList.contains('ap-page-intro')) node.classList.add('pure-policy-intro');
      node.classList.remove('ap-container', 'ap-page-intro', 'ap-editorial', 'ap-panel', 'ap-guide');
    });
    main.className = 'pure-policy-main';
    main.id = 'pure-policy-main';
    main.removeAttribute('style');
    const title = main.querySelector('h1');
    title.id ||= 'pure-policy-title';
    main.setAttribute('aria-labelledby', title.id);
    const effective = main.querySelector('.effective');
    if (effective) title.after(effective);
    const titleNote = title.nextElementSibling;
    if (titleNote?.tagName === 'P' && /^(?:Version\s|Effective\s|Updated\s)/i.test(titleNote.textContent.trim())) {
      titleNote.classList.add('pure-policy-meta');
    }
    assert.deepEqual(textFragments(main), contentBefore, 'Policy text changed: ' + file);
    assert.deepEqual([...main.querySelectorAll('a[href]')].map(a => [a.textContent.trim(), a.getAttribute('href')]), linksBefore, 'Policy links changed: ' + file);

    const content = document.createElement('div');
    content.className = 'pure-policy-content';
    content.append(...main.childNodes);
    main.append(content);
    if (!content.querySelector('.ap-eyebrow')) {
      const label = document.createElement('p');
      label.className = 'pure-policy-kicker';
      label.setAttribute('data-pure-policy-label', '');
      label.textContent = 'PURE POLICIES';
      title.before(label);
    }

    // The old policy styles used unscoped header/footer rules. Replace those
    // with the exact public shell's layers, then the scoped reading styles.
    document.head.querySelectorAll('style, link[rel="stylesheet"]').forEach(node => node.remove());
    for (const style of styles) document.head.append(document.importNode(style, true));
    const policyStyle = document.createElement('link');
    policyStyle.rel = 'stylesheet';
    policyStyle.href = '/pure-policy.css?v=20261118';
    document.head.append(policyStyle);
    document.body.className = 'ap-site pure-policy-page';
    document.body.replaceChildren();
    for (const node of headerNodes) {
      const copy = document.importNode(node, true);
      if (copy.classList.contains('ap-skip')) copy.setAttribute('href', '#pure-policy-main');
      document.body.append(copy);
    }
    document.body.append(main, document.importNode(footer, true));
    for (const node of controls) document.body.append(document.importNode(node, true));
    for (const script of scripts) document.body.append(document.importNode(script, true));
    fs.writeFileSync(target, dom.serialize());
    dom.window.close();
    count++;
  }
  shellDOM.window.close();
  console.log('Applied the shared PURE shell and reading layout to ' + count + ' policy and documentation pages; policy wording preserved.');
  return count;
};

module.exports.policyFiles = policyFiles;
