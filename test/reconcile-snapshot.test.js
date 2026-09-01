const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
const start = source.indexOf('function buildReconcileSnapshot');
const end = source.indexOf('\n}', start) + 2;
const ctx = {};
vm.runInNewContext(source.slice(start, end) + '\nthis.buildReconcileSnapshot = buildReconcileSnapshot;', ctx);
const build = (hasil, now) => JSON.parse(JSON.stringify(ctx.buildReconcileSnapshot(hasil, now)));

const HASIL = {
  totalKeranjang: 300500, totalStruk: 338900, selisih: 38400, hemat: 52300,
  jangkar: { cocok: true, takTerjelaskan: 0 },
  rows: [
    { i: 0, nama: 'Indomie', unitKeranjang: 2, unitStruk: 2, totalKeranjang: 6380, totalStruk: 6380, selisih: 0, status: 'sama' },
    { i: 1, nama: 'Bumbu', unitKeranjang: 1, unitStruk: 1, totalKeranjang: 1540, totalStruk: 1440, selisih: -100, status: 'lebih_murah' },
  ],
  asing: [{ nama: 'KANZLER NUGG SPCY', qty: 1, net: 38900 }],
};

test('snapshot v2: menandai versi dan menyimpan angka apa adanya', () => {
  const s = build(HASIL, 1737431000000);
  assert.strictEqual(s.v, 2);
  assert.strictEqual(s.at, 1737431000000);
  assert.strictEqual(s.totalKeranjang, 300500);
  assert.strictEqual(s.totalStruk, 338900);
  assert.strictEqual(s.selisih, 38400);
  assert.strictEqual(s.hemat, 52300);
  assert.deepStrictEqual(s.jangkar, { cocok: true, takTerjelaskan: 0 });
});

test('snapshot v2: baris diringkas, unit ikut tersimpan', () => {
  const s = build(HASIL, 1);
  assert.strictEqual(s.rows.length, 2);
  assert.deepStrictEqual(s.rows[1], {
    nama: 'Bumbu', unitKeranjang: 1, unitStruk: 1,
    totalKeranjang: 1540, totalStruk: 1440, status: 'lebih_murah',
  });
});

test('snapshot v2: baris asing tersimpan', () => {
  const s = build(HASIL, 1);
  assert.deepStrictEqual(s.asing, [{ nama: 'KANZLER NUGG SPCY', qty: 1, net: 38900 }]);
});

test('snapshot v2: hasil kosong tak melempar', () => {
  const s = build({ rows: [], asing: [], jangkar: { cocok: false, takTerjelaskan: 0 } }, 1);
  assert.strictEqual(s.v, 2);
  assert.deepStrictEqual(s.rows, []);
});
