'use strict';

// Server-only transport. Callers decide the recipient and whether sending is authorized.
async function sendEmail(message, { env = process.env, fetchImpl = fetch, idempotencyKey } = {}) {
  if (typeof env.RESEND_API_KEY !== 'string' || !env.RESEND_API_KEY.trim()) {
    throw new Error('Email transport unavailable.');
  }
  const response = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST', redirect: 'error',
    signal: AbortSignal.timeout(10000),
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {})
    },
    body: JSON.stringify(message)
  });
  if (!response.ok || Number(response.headers?.get('content-length') || 0) > 16384) {
    await response.body?.cancel().catch(() => {});
    throw new Error('Email delivery unavailable.');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Email delivery unavailable.');
  const chunks = []; let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 16384) { await reader.cancel(); throw new Error('Email delivery unavailable.'); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  let result; try { result = JSON.parse(Buffer.concat(chunks, length).toString('utf8')); } catch {}
  if (typeof result?.id !== 'string' || result.id.length > 200) throw new Error('Email delivery unavailable.');
  return { id: result.id };
}

module.exports = { sendEmail };
