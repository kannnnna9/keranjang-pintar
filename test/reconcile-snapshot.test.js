const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
const start = source.indexOf('function buildReconcileSnapshot');
const end = source.indexOf('\n}', start) + 2;
const body = source.slice(start, end);
const ctx = {};
vm.runInNewContext(body + '\nthis.buildReconcileSnapshot = buildReconcileSnapshot;', ctx);
const build = (rows, now) => ctx.buildReconcileSnapshot(rows, now);

test('hitung total rak, kasir, selisih, dan waktu', () => {
  const rows = [
    { nama: 'Indomie', hargaRak: 3500, hargaKasir: 4000, status: 'beda' },
    { nama: 'Beras',   hargaRak: 64000, hargaKasir: 64000, status: 'sama' },
  ];
  const s = build(rows, 1737431000000);
  assert.strictEqual(s.totalRak, 67500);
  assert.strictEqual(s.totalKasir, 68000);
  assert.strictEqual(s.selisih, 500);
  assert.strictEqual(s.at, 1737431000000);
  assert.strictEqual(s.rows.length, 2);
});

test('baris tak_ketemu: hargaKasir null tak dihitung sebagai kasir 0, pakai hargaRak', () => {
  const rows = [
    { nama: 'Teh', hargaRak: 5000, hargaKasir: null, status: 'tak_ketemu' },
  ];
  const s = build(rows, 1);
  assert.strictEqual(s.totalRak, 5000);
  assert.strictEqual(s.totalKasir, 5000);
  assert.strictEqual(s.selisih, 0);
});

test('rows kosong => nol semua', () => {
  const s = build([], 1);
  assert.deepStrictEqual({ totalRak: s.totalRak, totalKasir: s.totalKasir, selisih: s.selisih, n: s.rows.length }, { totalRak: 0, totalKasir: 0, selisih: 0, n: 0 });
});

test('rows dipersempit ke field yang perlu saja (nama, hargaRak, hargaKasir, status)', () => {
  const s = build([{ nama: 'X', hargaRak: 10, hargaKasir: 12, status: 'beda', foo: 'buang' }], 1);
  const row = s.rows[0];
  assert.strictEqual(row.nama, 'X');
  assert.strictEqual(row.hargaRak, 10);
  assert.strictEqual(row.hargaKasir, 12);
  assert.strictEqual(row.status, 'beda');
  assert.strictEqual(Object.keys(row).length, 4);
  assert.strictEqual(row.foo, undefined);
});
