const { test } = require('node:test');
const assert = require('node:assert');
const R = require('../retention.js');

const HOUR = 3600 * 1000;

test('nextExpiry: pending = createdAt + 24 jam', () => {
  assert.strictEqual(R.nextExpiry('pending', 1000), 1000 + 24 * HOUR);
});

test('nextExpiry: matched_same = matchedAt + 8 jam', () => {
  assert.strictEqual(R.nextExpiry('matched_same', 5000), 5000 + 8 * HOUR);
});

test('nextExpiry: matched_diff = matchedAt + 24 jam', () => {
  assert.strictEqual(R.nextExpiry('matched_diff', 5000), 5000 + 24 * HOUR);
});

test('nextExpiry: evidence = null (permanen)', () => {
  assert.strictEqual(R.nextExpiry('evidence', 5000), null);
});

test('pemetaan status v2.8.0 ke durasi retensi', () => {
  assert.strictEqual(R.mapMatchStatus('sama'), 'matched_same');
  assert.strictEqual(R.mapMatchStatus('lebih_mahal'), 'matched_diff');
  assert.strictEqual(R.mapMatchStatus('lebih_murah'), 'matched_diff');
  assert.strictEqual(R.mapMatchStatus('qty_beda'), 'matched_diff');
  assert.strictEqual(R.mapMatchStatus('tak_ketemu'), 'pending');
  assert.strictEqual(R.mapMatchStatus('tak_pasti'), 'pending');
  assert.strictEqual(R.mapMatchStatus('ngawur'), 'pending');
});

test('isExpired: expiresAt null tak pernah expired', () => {
  assert.strictEqual(R.isExpired({ expiresAt: null }, 9e15), false);
});

test('isExpired: expiresAt < now = expired', () => {
  assert.strictEqual(R.isExpired({ expiresAt: 1000 }, 2000), true);
  assert.strictEqual(R.isExpired({ expiresAt: 3000 }, 2000), false);
});

test('pickExpired: kembalikan id yang expired saja', () => {
  const recs = [
    { id: 'a', expiresAt: 1000 },
    { id: 'b', expiresAt: null },
    { id: 'c', expiresAt: 5000 },
  ];
  assert.deepStrictEqual(R.pickExpired(recs, 2000), ['a']);
});
