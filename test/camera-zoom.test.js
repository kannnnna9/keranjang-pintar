const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');

// app.js tak punya module system (script biasa untuk browser), jadi blok fungsi
// murni dipotong sebagai teks lalu dijalankan di sandbox. Pola sama dengan
// test/promo.test.js.
const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
const start = source.indexOf('/* ==== CAMERA ZOOM (start) ==== */');
const end = source.indexOf('/* ==== CAMERA ZOOM (end) ==== */');
if (start === -1 || end === -1) throw new Error('Penanda CAMERA ZOOM tidak ditemukan di app.js');
const ctx = {};
vm.runInNewContext(
  source.slice(start, end) +
  '\nthis.zoomLevels = zoomLevels;\nthis.zoomDiterima = zoomDiterima;',
  ctx,
);
// deepStrictEqual membandingkan prototype -> objek dari node:vm selalu ditolak.
const bawaKeRealmIni = (v) => JSON.parse(JSON.stringify(v));
const zoomLevels = (caps) => bawaKeRealmIni(ctx.zoomLevels(caps));
const zoomDiterima = (a, b, c) => ctx.zoomDiterima(a, b, c);

test('rentang pengali mutlak 1-10 memberi tiga tingkat', () => {
  assert.deepStrictEqual(zoomLevels({ min: 1, max: 10, step: 0.1 }), [
    { x: 1, nilai: 1 }, { x: 2, nilai: 2 }, { x: 4, nilai: 4 },
  ]);
});

test('rentang persen 100-400 dipetakan dari min sebagai 1x', () => {
  assert.deepStrictEqual(zoomLevels({ min: 100, max: 400, step: 1 }), [
    { x: 1, nilai: 100 }, { x: 2, nilai: 200 }, { x: 4, nilai: 400 },
  ]);
});

test('HP yang cuma sanggup 2x tak menawarkan 4x', () => {
  assert.deepStrictEqual(zoomLevels({ min: 1, max: 2 }), [
    { x: 1, nilai: 1 }, { x: 2, nilai: 2 },
  ]);
});

test('cuma 1x yang lolos -> baris disembunyikan', () => {
  assert.deepStrictEqual(zoomLevels({ min: 1, max: 1.5 }), []);
});

test('HP tanpa dukungan zoom -> baris disembunyikan', () => {
  assert.deepStrictEqual(zoomLevels(undefined), []);
  assert.deepStrictEqual(zoomLevels(null), []);
  assert.deepStrictEqual(zoomLevels({}), []);
});

test('min 0 -> satuan dianggap pengali mutlak, base jatuh ke 1', () => {
  assert.deepStrictEqual(zoomLevels({ min: 0, max: 8 }), [
    { x: 1, nilai: 1 }, { x: 2, nilai: 2 }, { x: 4, nilai: 4 },
  ]);
});

test('angka bertipe string dari WebView tetap terbaca', () => {
  assert.strictEqual(zoomLevels({ min: '1', max: '10' }).length, 3);
});

test('max NaN -> baris disembunyikan', () => {
  assert.deepStrictEqual(zoomLevels({ min: 1, max: NaN }), []);
});

test('baca-balik: nilai sama dianggap diterima', () => {
  assert.strictEqual(zoomDiterima(2, 2, 0.1), true);
});

test('baca-balik: dijepit ke maksimum dianggap DITOLAK', () => {
  assert.strictEqual(zoomDiterima(4, 3, 0.1), false);
});

test('baca-balik: HP tak melaporkan zoom -> percaya applyConstraints', () => {
  assert.strictEqual(zoomDiterima(2, undefined, 0.1), true);
  assert.strictEqual(zoomDiterima(2, null, 0.1), true);
});

test('baca-balik: selisih dalam satu step masih diterima', () => {
  assert.strictEqual(zoomDiterima(200, 200.05, 1), true);
});
