const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
const start = source.indexOf('async function manualMatch');
const end = source.indexOf('\nfunction fileToBase64', start);
if (start === -1 || end === -1) throw new Error('manualMatch tidak ditemukan di app.js');
const body = source.slice(start, end);

test('manualMatch meneruskan hasil v2 agar retention foto memakai indeks grup', async () => {
  let received;
  let rendered;
  const rows = [{ nama: 'Teh', hargaKasir: null, status: 'tak_ketemu' }];
  const ctx = {
    prompt: () => '120',
    cart: [{ nama: 'Teh', harga: 100 }],
    lastGrup: [{ i: 4, nama: 'Teh', rowIdx: [0] }],
    lastReconcile: rows,
    applyReconcileResult: async (hasil) => { received = JSON.parse(JSON.stringify(hasil)); },
    renderReconcile: (hasil) => { rendered = hasil; },
  };
  vm.runInNewContext(body + '\nthis.manualMatch = manualMatch;', ctx);

  await ctx.manualMatch('Teh');

  assert.deepStrictEqual(received, {
    rows: [{ i: 4, nama: 'Teh', hargaRak: 100, totalStruk: 120, status: 'lebih_mahal' }],
  });
  assert.strictEqual(ctx.lastReconcile[0].hargaKasir, 120);
  assert.strictEqual(ctx.lastReconcile[0].status, 'lebih_mahal');
  assert.strictEqual(rendered, rows);
});

test('tambahDariStruk menambah lokal dan memperbarui entri riwayat sesi yang sama', async () => {
  const saved = [];
  let applied;
  let rendered;
  let toast;
  const history = [{ ts: 123, sessionId: 'sama', total: 100, items: [{ nama: 'Lama', harga: 100, qty: 1 }] }];
  const ctx = {
    cart: [],
    cartSessionId: 'sama',
    lastBaris: [{ nama: 'Kanzler', total: 2880 }],
    lastReconcile: { asing: [{ nama: 'Kanzler', net: 2880, qty: 2 }] },
    barisDariStruk: (net, qty) => ({ harga: net / qty, qty }),
    persistCart: () => {},
    renderCart: () => {},
    loadHistory: () => history,
    itemQty: (it) => it.qty || 1,
    cartTotal: () => ctx.cart.reduce((total, it) => total + it.harga * it.qty, 0),
    HISTORY_STORAGE: 'history',
    localStorage: { setItem: (key, value) => saved.push([key, JSON.parse(value)]) },
    grupKeranjang: (cart) => cart.map((it, i) => ({ i, nama: it.nama, unit: it.qty, total: it.harga * it.qty, rowIdx: [i] })),
    reconcileHitung: (grup, baris) => ({ rows: grup, asing: [], baris }),
    applyReconcileResult: async (hasil) => { applied = hasil; },
    renderReconcile: (hasil) => { rendered = hasil; },
    showToast: (message) => { toast = message; },
  };
  vm.runInNewContext(body + '\nthis.tambahDariStruk = tambahDariStruk;', ctx);

  assert.strictEqual(typeof ctx.tambahDariStruk, 'function');
  await ctx.tambahDariStruk(0);

  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.cart)), [
    { nama: 'Kanzler', harga: 1440, qty: 2, promo: null, dariStruk: true },
  ]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.lastGrup)), [
    { i: 0, nama: 'Kanzler', unit: 2, total: 2880, rowIdx: [0] },
  ]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(applied)), {
    rows: [{ i: 0, nama: 'Kanzler', unit: 2, total: 2880, rowIdx: [0] }],
    asing: [],
    baris: [{ nama: 'Kanzler', total: 2880 }],
  });
  assert.strictEqual(rendered, applied);
  assert.strictEqual(toast, 'Ditambahkan dari struk');
  assert.deepStrictEqual(saved, [['history', [{
    ts: 123,
    sessionId: 'sama',
    total: 2880,
    items: [{ nama: 'Kanzler', harga: 1440, qty: 2, dariStruk: true }],
  }]]]);
});

test('tambahDariStruk mengabaikan klik kedua selama rekonsiliasi pertama berjalan', async () => {
  let lanjutkan;
  const ctx = {
    cart: [],
    lastBaris: [{ nama: 'Kanzler', total: 2880 }],
    lastReconcile: { asing: [{ nama: 'Kanzler', net: 2880, qty: 2 }] },
    barisDariStruk: (net, qty) => ({ harga: net / qty, qty }),
    persistCart: () => {},
    renderCart: () => {},
    perbaruiEntriRiwayat: () => {},
    grupKeranjang: (cart) => cart.map((it, i) => ({ i, nama: it.nama, unit: it.qty, total: it.harga * it.qty, rowIdx: [i] })),
    reconcileHitung: (grup) => ({ rows: grup, asing: [] }),
    applyReconcileResult: () => new Promise((resolve) => { lanjutkan = resolve; }),
    renderReconcile: () => {},
    showToast: () => {},
  };
  vm.runInNewContext(body + '\nthis.tambahDariStruk = tambahDariStruk;', ctx);

  const pertama = ctx.tambahDariStruk(0);
  const kedua = ctx.tambahDariStruk(0);

  assert.strictEqual(ctx.cart.length, 1);
  lanjutkan();
  await Promise.all([pertama, kedua]);
  assert.strictEqual(ctx.cart.length, 1);
});

test('tambahDariStruk menautkan baris asing yang dipilih ke grup baru lewat rekonsiliasi nyata', async () => {
  const rulesStart = source.indexOf('/* ==== RECONCILE RULES (start) ==== */');
  const rulesEnd = source.indexOf('/* ==== RECONCILE RULES (end) ==== */');
  const rules = source.slice(rulesStart, rulesEnd);
  let rendered;
  const ctx = {
    cart: [{ nama: 'Lama', harga: 100, qty: 1 }],
    lastBaris: [
      { urut: 1, peran: 'barang', nama: 'LAMA', qty: 1, harga: 100, total: 100, cocokKe: 0 },
      { urut: 2, peran: 'barang', nama: 'Kanzler', qty: 2, harga: 1440, total: 2880, cocokKe: -1 },
      { urut: 3, peran: 'total', nama: 'TOTAL', qty: 0, harga: 0, total: 2980, cocokKe: -1 },
    ],
    itemQty: (it) => Math.max(1, it.qty || 1),
    itemSub: (it) => it.harga * Math.max(1, it.qty || 1),
    persistCart: () => {}, renderCart: () => {}, perbaruiEntriRiwayat: () => {},
    applyReconcileResult: async () => {},
    renderReconcile: (hasil) => { ctx.lastReconcile = hasil; rendered = JSON.parse(JSON.stringify(hasil)); },
    showToast: () => {},
  };
  vm.runInNewContext(rules + '\n' + body + '\nthis.tambahDariStruk = tambahDariStruk;', ctx);
  ctx.lastGrup = ctx.grupKeranjang(ctx.cart);
  ctx.lastReconcile = ctx.reconcileHitung(ctx.lastGrup, ctx.lastBaris);

  await ctx.tambahDariStruk(0);
  await ctx.tambahDariStruk(0);

  assert.strictEqual(ctx.cart.length, 2);
  assert.strictEqual(ctx.lastBaris[1].cocokKe, 1);
  assert.strictEqual(rendered.rows[1].status, 'sama');
  assert.deepStrictEqual(rendered.asing, []);
});

test('tambahDariStruk hanya menautkan satu baris saat nama dan qty asing berulang', async () => {
  const rulesStart = source.indexOf('/* ==== RECONCILE RULES (start) ==== */');
  const rulesEnd = source.indexOf('/* ==== RECONCILE RULES (end) ==== */');
  const rules = source.slice(rulesStart, rulesEnd);
  let rendered;
  const ctx = {
    cart: [],
    lastBaris: [
      { urut: 1, peran: 'barang', nama: 'Kanzler', qty: 1, harga: 100, total: 100, cocokKe: -1 },
      { urut: 1, peran: 'barang', nama: 'Kanzler', qty: 1, harga: 100, total: 100, cocokKe: -1 },
      { urut: 3, peran: 'total', nama: 'TOTAL', qty: 0, harga: 0, total: 200, cocokKe: -1 },
    ],
    itemQty: (it) => Math.max(1, it.qty || 1),
    itemSub: (it) => it.harga * Math.max(1, it.qty || 1),
    persistCart: () => {}, renderCart: () => {}, perbaruiEntriRiwayat: () => {},
    applyReconcileResult: async () => {},
    renderReconcile: (hasil) => { rendered = JSON.parse(JSON.stringify(hasil)); },
    showToast: () => {},
  };
  vm.runInNewContext(rules + '\n' + body + '\nthis.tambahDariStruk = tambahDariStruk;', ctx);
  ctx.lastGrup = ctx.grupKeranjang(ctx.cart);
  ctx.lastReconcile = ctx.reconcileHitung(ctx.lastGrup, ctx.lastBaris);

  await ctx.tambahDariStruk(1);

  assert.strictEqual(ctx.lastBaris[0].cocokKe, -1);
  assert.strictEqual(ctx.lastBaris[1].cocokKe, 0);
  assert.deepStrictEqual(rendered.asing, [{ nama: 'Kanzler', qty: 1, net: 100 }]);
});
