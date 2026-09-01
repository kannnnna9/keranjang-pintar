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

const saveStart = source.indexOf('function saveReconcileToHistory');
const saveEnd = source.indexOf('\nfunction wireReconcileButtons', saveStart);
const historyStart = source.indexOf('async function showHistoryDetail');
const historyEnd = source.indexOf('\nasync function decorateHistoryPhotos', historyStart);

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

test('save riwayat menyimpan snapshot hasil v2 pada sesi aktif', () => {
  const history = [{ sessionId: 'aktif' }];
  let saved;
  const saveCtx = {
    Date: { now: () => 99 },
    HISTORY_STORAGE: 'history',
    cartSessionId: 'aktif',
    loadHistory: () => history,
    localStorage: { setItem: (_, value) => { saved = JSON.parse(value); } },
    showToast: assert.fail,
  };
  vm.runInNewContext(source.slice(saveStart, saveEnd) + '\nthis.save = saveReconcileToHistory;', saveCtx);

  saveCtx.save(HASIL);

  assert.strictEqual(saved[0].reconcile.v, 2);
  assert.strictEqual(saved[0].reconcile.at, 99);
  assert.deepStrictEqual(saved[0].reconcile.asing, HASIL.asing);
});

test('riwayat v2 merender nama OCR sebagai teks, bukan elemen HTML', async () => {
  const panel = {
    _html: '',
    set innerHTML(value) { this._html = String(value); this.hasImage = /<img(?:\s|>)/i.test(this._html); },
    get innerHTML() { return this._html; },
    querySelector(selector) { return selector === 'img' && this.hasImage ? {} : null; },
  };
  const elements = {
    'hist-detail-list': { innerHTML: '', appendChild: () => {} },
    'hist-detail-title': {}, 'hist-detail-count': {}, 'hist-detail-total': {},
    'btn-share-hist': { dataset: {} }, 'btn-del-hist': { dataset: {} },
    'hist-detail-reconcile': panel,
  };
  const renderCtx = {
    $: (id) => elements[id],
    loadHistory: () => [{
      ts: 1, total: 0, items: [],
      reconcile: {
        v: 2, totalKeranjang: 0, totalStruk: 0, selisih: 0, hemat: 0,
        rows: [{ nama: '<img src=x onerror=alert(1)>', totalKeranjang: 0, totalStruk: 1, status: 'lebih_mahal' }],
        asing: [{ nama: '<img src=y onerror=alert(2)>', net: 2 }],
      },
    }],
    decorateHistoryPhotos: async () => {}, fmtDate: () => '', itemQty: () => 1,
    rupiah: (n) => `Rp ${n}`, openSheet: () => {},
  };
  vm.runInNewContext(source.slice(historyStart, historyEnd) + '\nthis.show = showHistoryDetail;', renderCtx);

  await renderCtx.show(0);

  assert.strictEqual(panel.querySelector('img'), null);
  assert.match(panel.innerHTML, /&lt;img src=[xy] onerror=alert\([12]\)&gt;/);
});
