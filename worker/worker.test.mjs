import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

/* Production entrypoint має експортувати тільки fetch. Для тесту
   додаємо вузький export лише до тимчасової in-memory копії — у
   розгорнутий Worker він ніколи не потрапляє. */
const source = await readFile(new URL('./worker.js', import.meta.url), 'utf8');
const exposed = source + `\nexport const __metaTestForNode = {
  normalizeMetaEmail,
  normalizeMetaPhone,
  metaCookie,
  metaEventId,
  rememberMetaPurchase,
  sendMetaPurchase
};\n`;
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(exposed).toString('base64');
const { __metaTestForNode: __metaTest } = await import(moduleUrl);

const {
  normalizeMetaEmail,
  normalizeMetaPhone,
  metaCookie,
  metaEventId,
  rememberMetaPurchase,
  sendMetaPurchase
} = __metaTest;

assert.equal(normalizeMetaEmail(' Buyer@Example.COM '), 'buyer@example.com');
assert.equal(normalizeMetaPhone('+38 (067) 123-45-67'), '380671234567');
assert.equal(normalizeMetaPhone('067 123 45 67'), '380671234567');
assert.equal(metaCookie('fb.1.1720000000000.AbC_123-x'), 'fb.1.1720000000000.AbC_123-x');
assert.equal(metaCookie('not-a-meta-cookie'), '');
assert.equal(metaEventId('R-260815-123'), 'reyter_purchase_R-260815-123');

const values = new Map();
const kv = {
  async get(key, type) {
    const value = values.get(key) ?? null;
    return type === 'json' && value ? JSON.parse(value) : value;
  },
  async put(key, value) {
    values.set(key, value);
  }
};
const env = {
  CAPI_PENDING: kv,
  META_CAPI_TOKEN: 'test-secret-token'
};
const request = new Request('https://reyter.pzh6yz55nw.workers.dev', {
  method: 'POST',
  headers: {
    'CF-Connecting-IP': '203.0.113.8',
    'User-Agent': 'REYTER CAPI test'
  }
});
const order = {
  orderNum: 'R-260815-123',
  to: 'Buyer@Example.com',
  phone: '067 123 45 67',
  meta: {
    fbp: 'fb.1.1720000000000.123456789',
    fbc: 'fb.1.1720000000000.AbC_123-x'
  }
};
const bill = {
  lines: [{ id: 'SW-003', qty: 2, price: 880 }]
};

assert.equal(
  await rememberMetaPurchase(env, request, order, bill, 'invoice-test-1', 'pay-create'),
  true
);
const stored = JSON.parse(values.get('purchase:invoice-test-1'));
assert.equal(
  stored.userData.em[0],
  createHash('sha256').update('buyer@example.com').digest('hex')
);
assert.equal(
  stored.userData.ph[0],
  createHash('sha256').update('380671234567').digest('hex')
);
assert.equal(stored.userData.client_ip_address, '203.0.113.8');
assert.equal(stored.eventId, 'reyter_purchase_R-260815-123');
assert.deepEqual(stored.contentIds, ['SW-003']);

const originalFetch = globalThis.fetch;
const calls = [];
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), init, body: JSON.parse(String(init.body)) });
  return new Response(JSON.stringify({ events_received: 1 }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
};

try {
  const payment = {
    invoiceId: 'invoice-test-1',
    status: 'success',
    amount: 176000,
    ccy: 980,
    reference: 'R-260815-123',
    modifiedDate: new Date().toISOString()
  };
  assert.equal((await sendMetaPurchase(env, payment)).ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://graph.facebook.com/v25.0/1564358352080564/events');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer test-secret-token');
  assert.equal(calls[0].body.data[0].event_name, 'Purchase');
  assert.equal(calls[0].body.data[0].event_id, 'reyter_purchase_R-260815-123');
  assert.equal(calls[0].body.data[0].custom_data.value, 1760);
  assert.equal(calls[0].body.data[0].custom_data.currency, 'UAH');

  // Повторний webhook не робить другого запиту до Meta.
  assert.equal((await sendMetaPurchase(env, payment)).skipped, 'already_sent');
  assert.equal(calls.length, 1);
} finally {
  globalThis.fetch = originalFetch;
}

console.log('✓ Meta CAPI Purchase: контекст, хешування, payload і дедуплікація');
