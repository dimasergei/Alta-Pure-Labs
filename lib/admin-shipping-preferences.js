'use strict';

const SENDER_FIELDS = ['name', 'company', 'street1', 'street2', 'city', 'state', 'zip', 'country', 'phone', 'email'];
const PACKAGE_FIELDS = ['length', 'width', 'height', 'distance_unit', 'mass_unit'];
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function publicPreferences(row) {
  if (!row) return { version: 0, sender: null, package_defaults: null, updated_at: null };
  if (!Number.isSafeInteger(row.version) || row.version < 0) fail(503, 'Saved shipping preferences are temporarily unavailable.');
  return {
    version: row.version,
    sender: row.sender ? Object.fromEntries(SENDER_FIELDS.map(key => [key, row.sender[key] || ''])) : null,
    // Packed weight is deliberately absent even from the read representation.
    package_defaults: row.package_defaults ? Object.fromEntries(PACKAGE_FIELDS.map(key => [key, row.package_defaults[key]])) : null,
    updated_at: row.updated_at || null
  };
}

function senderProfile(input) {
  // Lazy import avoids a module cycle: shipping state reads these preferences.
  const sender = require('./admin-shipping-labels').address(input, 'Sender');
  if (!sender.email) fail(400, 'Enter the email address for this sender profile.');
  const digits = sender.phone.replace(/\D/g, '');
  if (!/^\+?[0-9(). -]+$/.test(sender.phone) || digits.length < 7 || digits.length > 15) {
    fail(400, 'Enter a valid sender phone number, including its country or area code.');
  }
  return sender;
}

function packageDefaults(input) {
  if (input === null) return null;
  if (!isObject(input)) fail(400, 'Enter package dimensions and units, or clear the saved package.');
  if (Object.hasOwn(input, 'weight')) fail(400, 'Save package dimensions and units only. Enter the actual packed weight for each order.');
  if (Object.keys(input).some(key => !PACKAGE_FIELDS.includes(key))) fail(400, 'The saved package contains an unsupported field.');
  if (!['in', 'cm'].includes(input.distance_unit) || !['lb', 'oz', 'g', 'kg'].includes(input.mass_unit)) fail(400, 'Choose valid package dimension and weight units.');
  const dimensions = Object.fromEntries(['length', 'width', 'height'].map(key => {
    const value = String(input[key] ?? '');
    if (!/^\d+(?:\.\d{1,4})?$/.test(value) || Number(value) <= 0 || Number(value) > 300) fail(400, 'Enter valid package dimensions greater than zero and no more than 300.');
    return [key, value];
  }));
  return { ...dimensions, distance_unit: input.distance_unit, mass_unit: input.mass_unit };
}

async function readPreferences(db) {
  const result = await db.from('admin_shipping_preferences').select('version,sender,package_defaults,updated_at').eq('id', true).maybeSingle();
  if (result.error) fail(503, 'Saved shipping preferences are temporarily unavailable.');
  return publicPreferences(result.data);
}

async function savePreferences(db, input) {
  if (!isObject(input) || !['sender', 'package'].includes(input.scope)) fail(400, 'Choose the sender profile or saved package to update.');
  if (!Number.isSafeInteger(input.version) || input.version < 0 || input.version >= 2147483647) fail(400, 'Reload shipping preferences before saving.');
  const value = input.scope === 'sender' ? senderProfile(input.sender) : packageDefaults(input.package_defaults);
  const result = await db.rpc('pure_admin_shipping_preferences_save', { p_scope: input.scope, p_expected_version: input.version, p_value: value });
  if (result.error) {
    if (result.error.code === '40001') fail(409, 'Shipping preferences changed in another session. Reload them before saving again.');
    if (result.error.code === '22023' || result.error.code === '23514') fail(400, 'The shipping preferences are invalid. Review the sender or package fields.');
    fail(503, 'Shipping preferences could not be saved. Please retry.');
  }
  if (!result.data) fail(503, 'Shipping preferences could not be saved. Please retry.');
  return publicPreferences(result.data);
}

module.exports = { readPreferences, savePreferences };
