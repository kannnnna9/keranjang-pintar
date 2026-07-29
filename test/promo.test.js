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

test('chip member: harga member + non-member, qty tidak dikunci', () => {
  const norm = normalizePromo({
    nama: 'Keju', harga: 33000, promoTipe: 'member', syarat: 'Khusus Member AlfaGift',
    hargaPromo: 33000, hargaNormal: 39000, semuaHarga: [33000, 39000],
  });
  const chips = promoChips(norm);
  assert.strictEqual(chips.length, 2);
  assert.strictEqual(chips[0].label, 'Member Rp33000');
  assert.strictEqual(chips[0].harga, 33000);
  assert.strictEqual(chips[0].lockQty, false);
  assert.deepStrictEqual(chips[0].promo, { tipe: 'member', label: 'Member', hargaNormal: 39000 });
  assert.strictEqual(chips[1].label, 'Non-member Rp39000');
  assert.strictEqual(chips[1].harga, 39000);
  assert.strictEqual(chips[1].promo, null);
});

test('chip bulk: coretan pakai harga tanpa promo untuk jumlah item yang sama', () => {
  const norm = normalizePromo({
    nama: 'Sabun', harga: 1500, promoTipe: 'bulk', promoQty: 3,
    hargaPromo: 4000, hargaNormal: 1500, semuaHarga: [1500, 4000],
  });
  const chips = promoChips(norm);
  assert.strictEqual(chips.length, 2);
  assert.strictEqual(chips[0].label, 'Paket 3 item Rp4000');
  assert.strictEqual(chips[0].harga, 4000);
  assert.strictEqual(chips[0].lockQty, true);
  assert.deepStrictEqual(chips[0].promo, { tipe: 'bulk', qtyPaket: 3, label: 'Paket 3 item', hargaNormal: 4500 });
  assert.strictEqual(chips[1].label, 'Satuan Rp1500');
});

test('chip bulk tanpa harga satuan: hanya satu chip, tanpa coretan', () => {
  const norm = normalizePromo({
    nama: 'Mi', harga: 10000, promoTipe: 'bulk', promoQty: 3,
    hargaPromo: 10000, hargaNormal: 0, semuaHarga: [10000],
  });
  const chips = promoChips(norm);
  assert.strictEqual(chips.length, 1);
  assert.strictEqual(chips[0].promo.hargaNormal, null);
});

test('chip gratis: harga paket hasil hitung, badge menyebut total item', () => {
  const norm = normalizePromo({
    nama: 'Teh Kotak', harga: 10000, promoTipe: 'gratis', beliQty: 2, gratisQty: 1,
    hargaNormal: 10000, syarat: 'Beli 2 Gratis 1', semuaHarga: [10000],
  });
  const chips = promoChips(norm);
  assert.strictEqual(chips.length, 2);
  assert.strictEqual(chips[0].label, 'Beli 2 gratis 1 · Rp20000 (3 item)');
  assert.strictEqual(chips[0].harga, 20000);
  assert.strictEqual(chips[0].lockQty, true);
  assert.deepStrictEqual(chips[0].promo, {
    tipe: 'gratis', qtyPaket: 3, label: 'Beli 2 gratis 1 · 3 item', hargaNormal: 30000,
  });
  assert.strictEqual(chips[1].harga, 10000);
  assert.strictEqual(chips[1].promo, null);
});

test('tipe none dan diskon tak punya chip; kandidat aktif juga tidak', () => {
  const none = normalizePromo({ nama: 'A', harga: 5000, promoTipe: 'none' });
  assert.deepStrictEqual(promoChips(none), []);
  const kandidat = normalizePromo({
    nama: 'B', harga: 5000, promoTipe: 'bulk', promoQty: 1, hargaPromo: 5000,
  });
  assert.strictEqual(kandidat.kandidat.aktif, true);
  assert.deepStrictEqual(promoChips(kandidat), []);
});

// Tiap pemicu kandidat wajib: alasan terisi, tipe dipaksa none, harga tak diisi
// otomatis, dan tak ada promo yang lolos ke keranjang.
const cekKandidat = (norm, alasan) => {
  assert.strictEqual(norm.kandidat.aktif, true);
  assert.strictEqual(norm.kandidat.alasan, alasan);
  assert.strictEqual(norm.tipe, 'none');
  assert.strictEqual(norm.hargaDefault, 0);
  assert.strictEqual(norm.promoDefault, null);
  assert.strictEqual(norm.peringatan, '');
};

test('kandidat 1: label kuning dengan beberapa harga', () => {
  cekKandidat(normalizePromo({
    nama: 'A', harga: 12000, promoTipe: 'none', labelWarna: 'kuning',
    semuaHarga: [12000, 15000],
  }), 'Label kuning & beberapa harga — pilih yang benar');
});

test('kandidat 2: diskon/member dengan harga tak lengkap', () => {
  cekKandidat(normalizePromo({
    nama: 'A', harga: 39000, promoTipe: 'diskon', hargaPromo: 0, hargaNormal: 39000,
  }), 'Harga promo/normal tak lengkap');
});

test('kandidat 3: harga promo tak lebih murah dari harga normal', () => {
  cekKandidat(normalizePromo({
    nama: 'A', harga: 39000, promoTipe: 'diskon', hargaPromo: 39000, hargaNormal: 33000,
  }), 'Harga promo tak lebih murah');
});

test('kandidat 4: data paket tak lengkap', () => {
  cekKandidat(normalizePromo({
    nama: 'A', harga: 4000, promoTipe: 'bulk', promoQty: 1, hargaPromo: 4000,
  }), 'Data paket tak lengkap');
});

test('kandidat 5: harga paket tak lebih murah dari satuan x jumlah', () => {
  cekKandidat(normalizePromo({
    nama: 'A', harga: 1500, promoTipe: 'bulk', promoQty: 3,
    hargaPromo: 5000, hargaNormal: 1500,
  }), 'Harga paket tak lebih murah');
});

test('kandidat 6: data beli-gratis tak lengkap', () => {
  cekKandidat(normalizePromo({
    nama: 'A', harga: 10000, promoTipe: 'gratis', beliQty: 2, gratisQty: 0,
    hargaNormal: 10000,
  }), 'Data beli-gratis tak lengkap');
});

test('kuning dengan satu harga: peringatan lembut, harga TETAP terisi', () => {
  const norm = normalizePromo({
    nama: 'A', harga: 12000, promoTipe: 'none', labelWarna: 'kuning', semuaHarga: [12000],
  });
  assert.strictEqual(norm.kandidat.aktif, false);
  assert.strictEqual(norm.peringatan, 'Label kuning — biasanya promo. Cek syaratnya.');
  assert.strictEqual(norm.hargaDefault, 12000);
});

test('anti-regresi: label putih dengan dua harga (harga per-100g) jalan normal', () => {
  const norm = normalizePromo({
    nama: 'Daging', harga: 25000, promoTipe: 'none', labelWarna: 'putih',
    semuaHarga: [2500, 25000],
  });
  assert.strictEqual(norm.kandidat.aktif, false);
  assert.strictEqual(norm.peringatan, '');
  assert.strictEqual(norm.hargaDefault, 25000);
});
