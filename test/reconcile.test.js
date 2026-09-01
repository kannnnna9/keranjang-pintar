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

/* Fixture struk Super Indo 31-08-26 20:42 — CONTOH YANG TERAMATI, BUKAN KONTRAK
   FORMAT. Reza belanja di lebih dari satu toko; tiap toko beda format. Fixture ini
   dipakai karena inilah struk yang membuat fitur v2.3.0 melaporkan 15 "beda harga"
   palsu dan melewatkan satu barang tak discan senilai Rp38.900.
   Kolom: [urut, peran, nama, qty, harga, total, cocokKe] */
const B = (urut, peran, nama, qty, harga, total, cocokKe) =>
  ({ urut, peran, nama, qty, harga, total, cocokKe });
const H = (urut, total) => B(urut, 'potongan', 'HEMAT', 0, 0, total, -1);

const CART_SUPERINDO = [
  { nama: 'BIOKUL YOGURT TO GO BROWN SUGAR 80G', harga: 5910, qty: 1 },
  { nama: 'EMINA CHE/S CEDDA10S', harga: 13990, qty: 1 },
  { nama: 'LIANG SHI FU BLACK SESAME OIL 110ML', harga: 30860, qty: 1 },
  { nama: 'SEGITIGA BIRU 1 KG', harga: 12990, qty: 1 },
  { nama: 'ROYCO AYAM 6X8GR', harga: 3790, qty: 4 },
  { nama: 'INDOFOOD BUMBU RACIK TEMPE GORENG 20GR', harga: 1540, qty: 1 },
  { nama: 'INDOFOOD BUMBU RACIK AYAM GORENG 26GR', harga: 1540, qty: 1 },
  { nama: 'INDOFOOD BUMBU RACIK SAYUR LODEH 25G', harga: 1540, qty: 1 },
  { nama: 'INDOFOOD BUMBU RACIK SAYUR SOP 20GR', harga: 1540, qty: 1 },
  { nama: 'INFOFOOD BUMBU RACIK IKAN GORENG 20GR', harga: 1540, qty: 1 },
  { nama: 'PRONAS CORNED BEEF CLASSIC 500G', harga: 6900, qty: 1 },
  { nama: 'MIGELAS KR AYAM 6X28', harga: 7790, qty: 1 },
  { nama: 'INDOMI GRNG CAKALA82', harga: 3190, qty: 2 },
  { nama: 'DASUIB RICE/P BLT20', harga: 19790, qty: 1 },
  { nama: 'SOHUN 100G', harga: 7900, qty: 1 },
  { nama: 'KAHF DEODORANT COOLING POWER 45ML', harga: 22670, qty: 1 },
  { nama: "TESSA FACIAL TISSUE TP-06 PA 2X200'S", harga: 16095, qty: 1 },
  { nama: 'KOJIE SAN SKIN LIGHTENING SOAP KOJIC ACID 135G', harga: 35435, qty: 1 },
  { nama: 'MARINA HAND BODY LOTION UV WHITE EXTRA SPF30 185ML', harga: 14790, qty: 1 },
  { nama: 'GIV SABUN MANDI WHITE BENGKOANG YOGH 5XX', harga: 11190, qty: 1 },
  { nama: 'MY BABY M/TELON60', harga: 18490, qty: 1 },
  { nama: '3M S/BRITE EASY CLN', harga: 10490, qty: 1 },
  { nama: 'WONHAE TOPOKKI SNACK CHEESE', harga: 8990, qty: 1 },
  { nama: 'K/API SUPER BLK CF10', harga: 12490, qty: 1 },
  { nama: 'KANZLER GOCHU JNG120', harga: 14490, qty: 1 },
];

const STRUK_SUPERINDO = [
  B(1, 'barang', 'WONHAE TOPOK CHE/', 1, 10490, 10490, 22), H(2, -1500),
  B(3, 'barang', 'TESSA FAC.TP06 2X', 1, 22990, 22990, 16), H(4, -6895),
  B(5, 'barang', 'INDOMI GRNG CAKAL', 2, 3190, 6380, 12),
  B(6, 'barang', 'K/API SUPER BLK C', 1, 12490, 12490, 23),
  B(7, 'barang', 'ROYCO AYAM 6X8GR', 4, 3790, 15160, 4),
  B(8, 'barang', 'INDOF B.RACIK LOD', 1, 1890, 1890, 7), H(9, -450),
  B(10, 'barang', 'INDOF RACIK SY/SO', 1, 1890, 1890, 8), H(11, -450),
  B(12, 'barang', 'INDOFOOD RCK I/GR', 1, 1890, 1890, 9), H(13, -450),
  B(14, 'barang', 'INDOFOOD B/R TEMP', 2, 1890, 3780, 5), H(15, -900),
  B(16, 'barang', 'INDOF B/RACIK A/G', 1, 1890, 1890, 6), H(17, -450),
  B(18, 'barang', 'BIOKUL YOG BRWN/S', 1, 7390, 7390, 0), H(19, -1480),
  B(20, 'barang', 'KAHF DEO COOL.PWD', 1, 25190, 25190, 15), H(21, -2520),
  B(22, 'barang', 'MIGELAS KR AYAM 6', 1, 7790, 7790, 11),
  B(23, 'barang', 'KANZLER GOCHU JNG', 1, 14490, 14490, 24),
  B(24, 'barang', 'PRONAS COR/B CLS5', 1, 8790, 8790, 10), H(25, -1890),
  B(26, 'barang', 'EMINA CHE/S CEDDA', 1, 13990, 13990, 1),
  B(27, 'barang', 'DASUIB RICE/P BLT', 1, 19790, 19790, 13),
  B(28, 'barang', 'SEGITIGA BIRU 1 K', 1, 12990, 12990, 3),
  B(29, 'barang', '3M S/BRITE EASY C', 1, 10490, 10490, 21),
  B(30, 'barang', 'MARINA LOT SPF30', 1, 19790, 19790, 18), H(31, -5000),
  B(32, 'barang', 'K/S SOAP KOJIC/AC', 1, 41690, 41690, 17), H(33, -6255),
  B(34, 'barang', 'GIV SBN W/BENGK3X', 1, 12690, 12690, 19), H(35, -1500),
  B(36, 'barang', '365 SOHUN100', 1, 9490, 9490, 14), H(37, -1590),
  B(38, 'barang', 'MY BABY M/TELON60', 1, 18490, 18490, 20),
  B(39, 'barang', 'L/SF SESAME OIL11', 1, 34290, 34290, 2), H(40, -3430),
  // Kasir men-scan tempe dobel lalu MEMBATALKAN satu: qty negatif + potongan dibalik.
  B(41, 'barang', 'INDOFOOD B/R TEMP', -1, 1890, -1890, 5), H(42, 450),
  // Barang yang sengaja TIDAK discan Reza — tak tertaut ke grup mana pun.
  B(43, 'barang', 'KANZLER NUGG SPCY', 1, 56890, 56890, -1), H(44, -17990),
  B(45, 'total', 'Sub Total (Termasuk PPN)', 0, 0, 338900, -1),
  B(46, 'penyesuaian', 'Pembulatan', 0, 0, 0, -1),
  B(47, 'total', 'TOTAL', 0, 0, 338900, -1),
  B(48, 'pembayaran', 'Pembayaran Tunai', 0, 0, 350000, -1),
  B(49, 'pembayaran', 'KEMBALI', 0, 0, 11100, -1),
];

const hitungSuperIndo = () => reconcileHitung(grupKeranjang(CART_SUPERINDO), STRUK_SUPERINDO);

test('fixture: total, selisih, dan hemat persis seperti struk asli', () => {
  const r = hitungSuperIndo();
  assert.strictEqual(r.totalKeranjang, 300500);
  assert.strictEqual(r.totalStruk, 338900);
  assert.strictEqual(r.selisih, 38400);
  assert.strictEqual(r.hemat, 52300);
  assert.strictEqual(r.jangkar.cocok, true);
  assert.strictEqual(r.jangkar.takTerjelaskan, 0);
});

test('fixture: ANTI-REGRESI — nol tuduhan "ditagih lebih mahal"', () => {
  const r = hitungSuperIndo();
  assert.deepStrictEqual(r.rows.filter((x) => x.status === 'lebih_mahal'), []);
});

test('fixture: barang tak discan muncul sebagai baris asing dengan harga bersih', () => {
  const r = hitungSuperIndo();
  assert.deepStrictEqual(r.asing, [{ nama: 'KANZLER NUGG SPCY', qty: 1, net: 38900 }]);
});

test('fixture: lima bumbu racik ditagih Rp100 lebih murah dari label rak', () => {
  const r = hitungSuperIndo();
  const murah = r.rows.filter((x) => x.status === 'lebih_murah');
  assert.strictEqual(murah.length, 5);
  murah.forEach((x) => {
    assert.strictEqual(x.totalKeranjang, 1540);
    assert.strictEqual(x.totalStruk, 1440);
    assert.strictEqual(x.selisih, -100);
    assert.strictEqual(x.unitKeranjang, 1);
    assert.strictEqual(x.unitStruk, 1);
  });
});

test('fixture: 20 item sisanya sesuai, tak ada qty_beda / tak_ketemu / tak_pasti', () => {
  const r = hitungSuperIndo();
  assert.strictEqual(r.rows.length, 25);
  assert.strictEqual(r.rows.filter((x) => x.status === 'sama').length, 20);
  assert.strictEqual(r.rows.filter((x) => x.status === 'qty_beda').length, 0);
  assert.strictEqual(r.rows.filter((x) => x.status === 'tak_ketemu').length, 0);
  assert.strictEqual(r.rows.filter((x) => x.status === 'tak_pasti').length, 0);
});

test('fixture: baris void tempe tidak memicu qty_beda', () => {
  const r = hitungSuperIndo();
  const tempe = r.rows.find((x) => x.nama === 'INDOFOOD BUMBU RACIK TEMPE GORENG 20GR');
  assert.strictEqual(tempe.unitStruk, 1);
  assert.strictEqual(tempe.totalStruk, 1440);
  assert.strictEqual(tempe.status, 'lebih_murah');
});

test('fixture: baris pembayaran tak pernah jadi baris asing', () => {
  const r = hitungSuperIndo();
  const nama = r.asing.map((a) => a.nama);
  assert.ok(!nama.includes('Pembayaran Tunai'));
  assert.ok(!nama.includes('KEMBALI'));
});

test('urutan putusan: qty diperiksa SEBELUM harga', () => {
  const grup = grupKeranjang([{ nama: 'Indomie', harga: 3500, qty: 1 }]);
  const r = reconcileHitung(grup, [
    { urut: 1, peran: 'barang', nama: 'IMG', qty: 2, harga: 3500, total: 7000, cocokKe: 0 },
    { urut: 2, peran: 'total', nama: 'TOTAL', qty: 0, harga: 0, total: 7000, cocokKe: -1 },
  ]);
  assert.strictEqual(r.rows[0].status, 'qty_beda');
  assert.strictEqual(r.rows[0].unitStruk, 2);
  assert.strictEqual(r.rows[0].unitKeranjang, 1);
  assert.strictEqual(r.rows[0].selisih, 3500);
});

test('promo bulk: paket 2 pcs, struk menagih penuh lalu memotong -> sesuai', () => {
  const grup = grupKeranjang([
    { nama: 'Indomie', harga: 9000, qty: 1, promo: { tipe: 'bulk', qtyPaket: 2 } },
  ]);
  const r = reconcileHitung(grup, [
    { urut: 1, peran: 'barang', nama: 'IMG', qty: 2, harga: 5000, total: 10000, cocokKe: 0 },
    { urut: 2, peran: 'potongan', nama: 'HEMAT', qty: 0, harga: 0, total: -1000, cocokKe: -1 },
    { urut: 3, peran: 'total', nama: 'TOTAL', qty: 0, harga: 0, total: 9000, cocokKe: -1 },
  ]);
  assert.strictEqual(r.rows[0].unitKeranjang, 2);
  assert.strictEqual(r.rows[0].status, 'sama');
  assert.strictEqual(r.jangkar.cocok, true);
});

test('promo gratis: beli 2 gratis 1 -> 3 barang fisik, tetap sesuai', () => {
  const grup = grupKeranjang([
    { nama: 'Susu', harga: 10000, qty: 1, promo: { tipe: 'gratis', qtyPaket: 3 } },
  ]);
  const r = reconcileHitung(grup, [
    { urut: 1, peran: 'barang', nama: 'SUSU', qty: 3, harga: 5000, total: 15000, cocokKe: 0 },
    { urut: 2, peran: 'potongan', nama: 'GRATIS 1', qty: 0, harga: 0, total: -5000, cocokKe: -1 },
    { urut: 3, peran: 'total', nama: 'TOTAL', qty: 0, harga: 0, total: 10000, cocokKe: -1 },
  ]);
  assert.strictEqual(r.rows[0].unitKeranjang, 3);
  assert.strictEqual(r.rows[0].status, 'sama');
});

test('nama kembar: dua baris keranjang vs satu baris struk qty 2 -> sesuai', () => {
  const grup = grupKeranjang([
    { nama: 'Teh', harga: 5000, qty: 1 },
    { nama: 'Teh', harga: 5000, qty: 1 },
  ]);
  const r = reconcileHitung(grup, [
    { urut: 1, peran: 'barang', nama: 'TEH KOTAK', qty: 2, harga: 5000, total: 10000, cocokKe: 0 },
    { urut: 2, peran: 'total', nama: 'TOTAL', qty: 0, harga: 0, total: 10000, cocokKe: -1 },
  ]);
  assert.strictEqual(r.rows.length, 1);
  assert.strictEqual(r.rows[0].unitKeranjang, 2);
  assert.strictEqual(r.rows[0].status, 'sama');
});

test('tak_ketemu: grup keranjang tanpa baris struk', () => {
  const grup = grupKeranjang([{ nama: 'Gula', harga: 15000, qty: 1 }]);
  const r = reconcileHitung(grup, [
    { urut: 1, peran: 'total', nama: 'TOTAL', qty: 0, harga: 0, total: 0, cocokKe: -1 },
  ]);
  assert.strictEqual(r.rows[0].status, 'tak_ketemu');
  assert.strictEqual(r.rows[0].unitStruk, 0);
});

test('tak_pasti: baris tertaut tapi angkanya tak terbaca', () => {
  const grup = grupKeranjang([{ nama: 'Gula', harga: 15000, qty: 1 }]);
  const r = reconcileHitung(grup, [
    { urut: 1, peran: 'barang', nama: 'GULA', qty: 0, harga: 0, total: 0, cocokKe: 0 },
    { urut: 2, peran: 'total', nama: 'TOTAL', qty: 0, harga: 0, total: 0, cocokKe: -1 },
  ]);
  assert.strictEqual(r.rows[0].status, 'tak_pasti');
});

test('daftar baris kosong tak melempar', () => {
  const r = reconcileHitung(grupKeranjang([{ nama: 'A', harga: 100, qty: 1 }]), []);
  assert.strictEqual(r.rows[0].status, 'tak_ketemu');
  assert.deepStrictEqual(r.asing, []);
  assert.strictEqual(r.jangkar.cocok, false);
});

test('cocokKe di luar grup keranjang dipertahankan sebagai barang asing', () => {
  const grup = grupKeranjang([{ nama: 'Gula', harga: 1000, qty: 1 }]);
  const r = reconcileHitung(grup, [
    { urut: 1, peran: 'barang', nama: 'GULA', qty: 1, harga: 1000, total: 1000, cocokKe: 0 },
    { urut: 2, peran: 'barang', nama: 'BARANG TAK TERTAUT', qty: 1, harga: 500, total: 500, cocokKe: 99 },
    { urut: 3, peran: 'total', nama: 'TOTAL', qty: 0, harga: 0, total: 1500, cocokKe: -1 },
  ]);
  assert.strictEqual(r.rows[0].status, 'sama');
  assert.deepStrictEqual(r.asing, [{ nama: 'BARANG TAK TERTAUT', qty: 1, net: 500 }]);
  assert.strictEqual(r.jangkar.cocok, true);
});
