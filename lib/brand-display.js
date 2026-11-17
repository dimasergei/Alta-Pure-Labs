'use strict';

// Keep the configured, verified mailbox intact while updating its display name.
function emailSender(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/^(\s*["']?)Alta[\s_-]*Pure([\s_-]*Labs)?(?=["']?\s*<)/i,
    (_, prefix, labs) => prefix + (labs ? 'PURE Labs' : 'PURE'));
}

module.exports = { emailSender };
