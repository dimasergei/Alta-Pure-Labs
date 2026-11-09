'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

test('account header FAQ link targets the existing storefront section', () => {
  const account = readFileSync(resolve(__dirname, '../account.html'), 'utf8');
  const storefront = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
  assert.match(account, /<a href="\/#faq-section">FAQ<\/a>/);
  assert.doesNotMatch(account, /<a href="\/#faq">Help<\/a>/);
  assert.match(storefront, /id="faq-section"/);
});
