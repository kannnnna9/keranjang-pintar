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
this.rcTautkanPotongan = rcTautkanPotongan;
this.rcGrupStruk = rcGrupStruk;
this.rcJangkar = rcJangkar;
`,
  ctx,
);
// deepStrictEqual membandingkan prototype -> objek node:vm selalu ditolak.
const J = (v) => JSON.parse(JSON.stringify(v));
const unitFisik = (it) => ctx.unitFisik(it);
const grupKeranjang = (cart) => J(ctx.grupKeranjang(cart));
const reconcileHitung = (g, b) => J(ctx.reconcileHitung(g, b));
const barisDariStruk = (net, qty) => J(ctx.barisDariStruk(net, qty));
const rcSan = (raw, i) => J(ctx.rcSanitasiBaris(raw, i || 0));
const rcPer = (b) => J(ctx.rcPeriksaPeran(b));
const rcPos = (list) => J(ctx.rcBatasPosisi(list));
const rcTaut = (list) => J(ctx.rcTautkanPotongan(list));
const rcGrup = (list, p) => J(ctx.rcGrupStruk(list, p));
const rcJang = (list) => J(ctx.rcJangkar(list));

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

test('sanitasi: angka bertitik & negatif terbaca benar', () => {
  const b = rcSan({ urut: 1, peran: 'barang', nama: 'Indomie', qty: 2, harga: '3.190', total: '6.380', cocokKe: 0 });
  assert.strictEqual(b.harga, 3190);
  assert.strictEqual(b.total, 6380);
  const v = rcSan({ urut: 9, peran: 'barang', nama: 'Void', qty: -1, harga: 1890, total: '-1.890', cocokKe: 0 });
  assert.strictEqual(v.qty, -1);
  assert.strictEqual(v.total, -1890);
});

test('sanitasi: peran di luar enum jatuh ke lain, cocokKe dipaksa -1', () => {
  const b = rcSan({ urut: 1, peran: 'ngawur', nama: 'X', cocokKe: 3, total: 100 });
  assert.strictEqual(b.peran, 'lain');
  assert.strictEqual(b.cocokKe, -1);
});

test('sanitasi: cocokKe hilang TIDAK boleh jadi 0 (itu grup pertama)', () => {
  const b = rcSan({ urut: 1, peran: 'barang', nama: 'X', total: 100 });
  assert.strictEqual(b.cocokKe, -1);
});

test('sanitasi: total tak tercetak dihitung JS dari harga x qty', () => {
  const b = rcSan({ urut: 1, peran: 'barang', nama: 'X', qty: 3, harga: 2000, total: 0, cocokKe: 1 });
  assert.strictEqual(b.total, 6000);
});

test('pemeriksa peran: TOTAL yang dilabeli barang diturunkan jadi total', () => {
  const b = rcPer({ urut: 5, peran: 'barang', nama: 'Sub Total (Termasuk PPN)', qty: 0, harga: 0, total: 338900, cocokKe: 2 });
  assert.strictEqual(b.peran, 'total');
  assert.strictEqual(b.cocokKe, -1);
});

test('pemeriksa peran: pembayaran & pembulatan & hemat dikenali', () => {
  assert.strictEqual(rcPer({ urut: 1, peran: 'barang', nama: 'Pembayaran Tunai', total: 350000, cocokKe: 0 }).peran, 'pembayaran');
  assert.strictEqual(rcPer({ urut: 2, peran: 'barang', nama: 'Pembulatan', total: 0, cocokKe: 0 }).peran, 'penyesuaian');
  assert.strictEqual(rcPer({ urut: 3, peran: 'barang', nama: 'HEMAT', total: -450, cocokKe: 0 }).peran, 'potongan');
});

test('pemeriksa peran: hanya boleh MENURUNKAN, peran non-barang tak disentuh', () => {
  const asal = { urut: 1, peran: 'lain', nama: 'TOTAL', total: 5, cocokKe: -1 };
  assert.deepStrictEqual(rcPer(asal), asal);
});

test('batas posisi: barang setelah baris total terakhir dipaksa lain', () => {
  const out = rcPos([
    { urut: 1, peran: 'barang', nama: 'Indomie', total: 3000, cocokKe: 0 },
    { urut: 2, peran: 'total', nama: 'TOTAL', total: 3000, cocokKe: -1 },
    { urut: 3, peran: 'barang', nama: 'EDC BCA', total: 3000, cocokKe: 0 },
  ]);
  assert.strictEqual(out[0].peran, 'barang');
  assert.strictEqual(out[2].peran, 'lain');
  assert.strictEqual(out[2].cocokKe, -1);
});

test('batas posisi: tanpa baris total, daftar tak diubah', () => {
  const list = [{ urut: 1, peran: 'barang', nama: 'A', total: 1, cocokKe: 0 }];
  assert.deepStrictEqual(rcPos(list), list);
});

test('potongan menempel ke barang terdekat di atasnya', () => {
  const p = rcTaut([
    { urut: 1, peran: 'barang', nama: 'Wonhae', qty: 1, harga: 10490, total: 10490, cocokKe: 0 },
    { urut: 2, peran: 'potongan', nama: 'HEMAT', qty: 0, harga: 0, total: -1500, cocokKe: -1 },
    { urut: 3, peran: 'barang', nama: 'Indomi', qty: 2, harga: 3190, total: 6380, cocokKe: 1 },
  ]);
  assert.deepStrictEqual(p, { 1: -1500 });
});

test('potongan SEBELUM barang pertama tak tertaut ke siapa pun', () => {
  const p = rcTaut([
    { urut: 1, peran: 'potongan', nama: 'DISKON BELANJA', total: -5000, cocokKe: -1 },
    { urut: 2, peran: 'barang', nama: 'A', qty: 1, harga: 1000, total: 1000, cocokKe: 0 },
  ]);
  assert.deepStrictEqual(p, {});
});

test('blok total menutup penautan: potongan setelah TOTAL tak dibebankan ke barang terakhir', () => {
  const p = rcTaut([
    { urut: 1, peran: 'barang', nama: 'A', qty: 1, harga: 1000, total: 1000, cocokKe: 0 },
    { urut: 2, peran: 'total', nama: 'TOTAL', total: 1000, cocokKe: -1 },
    { urut: 3, peran: 'potongan', nama: 'DISKON KUPON', total: -200, cocokKe: -1 },
  ]);
  assert.deepStrictEqual(p, {});
});

test('agregasi struk: baris void menetralkan qty dan net', () => {
  const baris = [
    { urut: 1, peran: 'barang', nama: 'B/R TEMP', qty: 2, harga: 1890, total: 3780, cocokKe: 0 },
    { urut: 2, peran: 'potongan', nama: 'HEMAT', total: -900, cocokKe: -1 },
    { urut: 3, peran: 'barang', nama: 'B/R TEMP', qty: -1, harga: 1890, total: -1890, cocokKe: 0 },
    { urut: 4, peran: 'potongan', nama: 'HEMAT', total: 450, cocokKe: -1 },
  ];
  const { grup, asing } = rcGrup(baris, rcTaut(baris));
  assert.deepStrictEqual(asing, []);
  assert.strictEqual(grup['0'].unit, 1);
  assert.strictEqual(grup['0'].net, 1440);
  assert.strictEqual(grup['0'].terbaca, true);
});

test('agregasi struk: baris tak tertaut jadi asing, satu per baris', () => {
  const baris = [
    { urut: 1, peran: 'barang', nama: 'KANZLER NUGG SPCY', qty: 1, harga: 56890, total: 56890, cocokKe: -1 },
    { urut: 2, peran: 'potongan', nama: 'HEMAT', total: -17990, cocokKe: -1 },
  ];
  const { grup, asing } = rcGrup(baris, rcTaut(baris));
  assert.deepStrictEqual(grup, {});
  assert.deepStrictEqual(asing, [{ nama: 'KANZLER NUGG SPCY', qty: 1, net: 38900 }]);
});

test('agregasi struk: baris tak terbaca menandai grupnya', () => {
  const baris = [{ urut: 1, peran: 'barang', nama: 'X', qty: 0, harga: 0, total: 0, cocokKe: 0 }];
  const { grup } = rcGrup(baris, {});
  assert.strictEqual(grup['0'].terbaca, false);
});

test('jangkar: bruto + potongan + penyesuaian === TOTAL tercetak', () => {
  const jk = rcJang([
    { urut: 1, peran: 'barang', nama: 'A', qty: 1, harga: 10000, total: 10000, cocokKe: 0 },
    { urut: 2, peran: 'potongan', nama: 'HEMAT', total: -1500, cocokKe: -1 },
    { urut: 3, peran: 'penyesuaian', nama: 'Pembulatan', total: -400, cocokKe: -1 },
    { urut: 4, peran: 'total', nama: 'Sub Total', total: 8100, cocokKe: -1 },
    { urut: 5, peran: 'total', nama: 'TOTAL', total: 8100, cocokKe: -1 },
  ]);
  assert.strictEqual(jk.bruto, 10000);
  assert.strictEqual(jk.potongan, -1500);
  assert.strictEqual(jk.penyesuaian, -400);
  assert.strictEqual(jk.hitungJS, 8100);
  assert.strictEqual(jk.jangkar, 8100);
  assert.strictEqual(jk.cocok, true);
  assert.strictEqual(jk.takTerjelaskan, 0);
});

test('jangkar: baris total TERAKHIR yang dipakai, bukan Sub Total', () => {
  const jk = rcJang([
    { urut: 1, peran: 'barang', nama: 'A', qty: 1, harga: 10000, total: 10000, cocokKe: 0 },
    { urut: 2, peran: 'total', nama: 'Sub Total', total: 10000, cocokKe: -1 },
    { urut: 3, peran: 'penyesuaian', nama: 'Pembulatan', total: -300, cocokKe: -1 },
    { urut: 4, peran: 'total', nama: 'TOTAL', total: 9700, cocokKe: -1 },
  ]);
  assert.strictEqual(jk.jangkar, 9700);
  assert.strictEqual(jk.cocok, true);
});

test('jangkar: transkripsi terpotong -> tak cocok, selisihnya terbaca', () => {
  const jk = rcJang([
    { urut: 1, peran: 'barang', nama: 'A', qty: 1, harga: 10000, total: 10000, cocokKe: 0 },
    { urut: 9, peran: 'total', nama: 'TOTAL', total: 25000, cocokKe: -1 },
  ]);
  assert.strictEqual(jk.cocok, false);
  assert.strictEqual(jk.takTerjelaskan, 15000);
});

test('jangkar: struk tanpa baris total sama sekali -> tak bisa diverifikasi', () => {
  const jk = rcJang([{ urut: 1, peran: 'barang', nama: 'A', qty: 1, harga: 500, total: 500, cocokKe: 0 }]);
  assert.strictEqual(jk.cocok, false);
  assert.strictEqual(jk.jangkar, 500);
});
