const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');

// app.js tak punya module system (script biasa untuk browser), jadi blok fungsi
// murni dipotong sebagai teks lalu dijalankan di sandbox. Pola sama dengan
// test/shopping-note.test.js. `rupiah` di-stub karena ia tinggal di luar blok.
const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
const start = source.indexOf('/* ==== PROMO RULES (start) ==== */');
const end = source.indexOf('/* ==== PROMO RULES (end) ==== */');
if (start === -1 || end === -1) throw new Error('Penanda PROMO RULES tidak ditemukan di app.js');
const ctx = { rupiah: (n) => 'Rp' + (Number(n) || 0) };
vm.runInNewContext(
  source.slice(start, end) +
  '\nthis.normalizePromo = normalizePromo;\nthis.promoChips = promoChips;',
  ctx,
);
const bawaKeRealmIni = (v) => JSON.parse(JSON.stringify(v));
const normalizePromo = (raw) => bawaKeRealmIni(ctx.normalizePromo(raw));
const promoChips = (norm) => bawaKeRealmIni(ctx.promoChips(norm));

test('bug lapangan #1: harga coret tanpa bukti member turun jadi diskon', () => {
  const norm = normalizePromo({
    nama: ' Keju Cheddar ', harga: 33000, promoTipe: 'member', syarat: '',
    hargaPromo: 33000, hargaNormal: 39000, semuaHarga: [33000, 39000],
  });
  assert.strictEqual(norm.nama, 'Keju Cheddar');
  assert.strictEqual(norm.tipe, 'diskon');
  assert.strictEqual(norm.kandidat.aktif, false);
  assert.strictEqual(norm.hargaDefault, 33000);
  assert.deepStrictEqual(norm.promoDefault, { tipe: 'diskon', label: 'Diskon', hargaNormal: 39000 });
  assert.deepStrictEqual(promoChips(norm), []);
});

test('member sah bila label menuliskan syaratnya', () => {
  const norm = normalizePromo({
    nama: 'Keju', harga: 33000, promoTipe: 'member', syarat: 'Khusus Member AlfaGift',
    hargaPromo: 33000, hargaNormal: 39000, semuaHarga: [33000, 39000],
  });
  assert.strictEqual(norm.tipe, 'member');
  assert.strictEqual(norm.hargaDefault, 0);
  assert.strictEqual(norm.promoDefault, null);
});

test('bug lapangan #2: beli 2 gratis 1 dihitung 2x satuan untuk 3 item', () => {
  const norm = normalizePromo({
    nama: 'Teh Kotak', harga: 10000, promoTipe: 'gratis', beliQty: 2, gratisQty: 1,
    hargaNormal: 10000, syarat: 'Beli 2 Gratis 1', semuaHarga: [10000],
  });
  assert.strictEqual(norm.kandidat.aktif, false);
  assert.strictEqual(norm.hargaPaket, 20000);
  assert.strictEqual(norm.totalItem, 3);
  assert.strictEqual(norm.hargaDefault, 0);
});

test('angka dibersihkan dari teks dan semuaHarga disaring', () => {
  const norm = normalizePromo({
    nama: 'Roti', harga: 'Rp 12.000', promoTipe: 'ngawur',
    semuaHarga: [85, '12.000', 12000, 20000000, 'abc'],
  });
  assert.strictEqual(norm.tipe, 'none');
  assert.strictEqual(norm.harga, 12000);
  assert.deepStrictEqual(norm.semuaHarga, [12000]);
  assert.strictEqual(norm.hargaDefault, 12000);
});

test('syarat dipotong 120 karakter dan labelWarna asing jadi lain', () => {
  const norm = normalizePromo({
    nama: 'X', harga: 5000, promoTipe: 'none', syarat: 'a'.repeat(200), labelWarna: 'ungu',
  });
  assert.strictEqual(norm.syarat.length, 120);
  assert.strictEqual(norm.labelWarna, 'lain');
});
