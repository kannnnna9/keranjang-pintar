const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
const start = source.indexOf('/* ==== RECONCILE RULES (start) ==== */');
const end = source.indexOf('/* ==== RECONCILE RULES (end) ==== */');
if (start === -1 || end === -1) throw new Error('Penanda RECONCILE RULES tidak ditemukan di app.js');

// itemQty & itemSub tinggal di luar blok (dipakai render keranjang juga), jadi
// di-stub dengan implementasi yang PERSIS sama seperti app.js:1414 & 1416.
const ctx = {
  itemQty: (it) => Math.max(1, it.qty || 1),
  itemSub: (it) => it.harga * Math.max(1, it.qty || 1),
};
vm.runInNewContext(
  source.slice(start, end) + `
this.unitFisik = unitFisik;
this.grupKeranjang = grupKeranjang;
this.reconcileHitung = reconcileHitung;
this.barisDariStruk = barisDariStruk;
this.rcSanitasiBaris = rcSanitasiBaris;
this.rcPeriksaPeran = rcPeriksaPeran;
this.rcBatasPosisi = rcBatasPosisi;
`,
  ctx,
);
// deepStrictEqual membandingkan prototype -> objek node:vm selalu ditolak.
const J = (v) => JSON.parse(JSON.stringify(v));
const unitFisik = (it) => ctx.unitFisik(it);
const grupKeranjang = (cart) => J(ctx.grupKeranjang(cart));
const reconcileHitung = (g, b) => J(ctx.reconcileHitung(g, b));
const barisDariStruk = (net, qty) => J(ctx.barisDariStruk(net, qty));

test('unitFisik: item biasa = qty', () => {
  assert.strictEqual(unitFisik({ harga: 3500, qty: 4 }), 4);
  assert.strictEqual(unitFisik({ harga: 3500 }), 1); // kompat data lama tanpa qty
});

test('unitFisik: paket bulk 2 pcs dengan qty terkunci 1 = 2 barang', () => {
  assert.strictEqual(unitFisik({ harga: 9000, qty: 1, promo: { tipe: 'bulk', qtyPaket: 2 } }), 2);
});

test('unitFisik: beli 2 gratis 1 = 3 barang fisik yang dibawa keluar', () => {
  assert.strictEqual(unitFisik({ harga: 10000, qty: 1, promo: { tipe: 'gratis', qtyPaket: 3 } }), 3);
});

test('unitFisik: promo tanpa qtyPaket (member/diskon) tak mengubah jumlah', () => {
  assert.strictEqual(unitFisik({ harga: 8000, qty: 2, promo: { tipe: 'member' } }), 2);
});

test('grupKeranjang: nama kembar digabung, total & unit dijumlahkan', () => {
  const g = grupKeranjang([
    { nama: 'Indomie', harga: 3190, qty: 2 },
    { nama: 'Teh', harga: 5000, qty: 1 },
    { nama: 'Indomie', harga: 3190, qty: 1 },
  ]);
  assert.strictEqual(g.length, 2);
  assert.deepStrictEqual(g[0], {
    i: 0, nama: 'Indomie', unit: 3, total: 9570, rowIdx: [0, 2], adaPromo: false,
  });
  assert.deepStrictEqual(g[1], {
    i: 1, nama: 'Teh', unit: 1, total: 5000, rowIdx: [1], adaPromo: false,
  });
});

test('grupKeranjang: indeks i berurutan dan rowIdx menunjuk baris keranjang asli', () => {
  const g = grupKeranjang([
    { nama: 'A', harga: 1000, qty: 1 },
    { nama: 'B', harga: 2000, qty: 1, promo: { tipe: 'bulk', qtyPaket: 2 } },
  ]);
  assert.deepStrictEqual(g.map((x) => x.i), [0, 1]);
  assert.deepStrictEqual(g[1].rowIdx, [1]);
  assert.strictEqual(g[1].unit, 2);
  assert.strictEqual(g[1].adaPromo, true);
});
