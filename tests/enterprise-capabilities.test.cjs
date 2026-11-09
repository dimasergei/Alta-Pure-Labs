'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CAPABILITIES, validateCapabilities, listCapabilities } = require('../lib/enterprise-capabilities');

test('enterprise capability registry is valid, complete and dependency-acyclic', () => {
  assert.deepEqual(validateCapabilities(), { valid: true, count: 19 });
  assert.equal(new Set(CAPABILITIES.map(c => c.id)).size, 19);
  for (const id of ['catalog', 'batch-coa-library', 'bulk-ordering', 'memberships',
    'rewards', 'subscriptions', 'affiliates', 'supplier-routing', 'international-lanes',
    'provider-adapters', 'checkout-cutover']) {
    assert.ok(CAPABILITIES.some(c => c.id === id), id);
  }
});

test('registry does not describe checkout cutover or provider adapters as active', () => {
  for (const id of ['provider-adapters', 'checkout-cutover']) {
    assert.equal(CAPABILITIES.find(c => c.id === id).stage, 'blocked');
  }
  assert.equal(CAPABILITIES.find(c => c.id === 'checkout-paused').stage, 'existing');
});

test('rejects missing dependencies, duplicate IDs and cycles', () => {
  assert.equal(validateCapabilities([{ id:'x', title:'X', stage:'planned', requires:['missing'] }]).valid, false);
  assert.equal(validateCapabilities([{ id:'x', title:'X', stage:'planned', requires:[] },
    { id:'x', title:'X', stage:'planned', requires:[] }]).valid, false);
  assert.equal(validateCapabilities([{ id:'x', title:'X', stage:'planned', requires:['y'] },
    { id:'y', title:'Y', stage:'planned', requires:['x'] }]).valid, false);
});

test('returned capability records cannot mutate source registry', () => {
  const items=listCapabilities('planned');
  assert.ok(items.length>0);
  items[0].requires.push('unexpected');
  assert.equal(validateCapabilities().valid, true);
});
