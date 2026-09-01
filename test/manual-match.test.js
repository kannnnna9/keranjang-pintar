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
    rows: [{ i: 4, nama: 'Teh', hargaRak: 100, totalStruk: 120, status: 'beda' }],
  });
  assert.strictEqual(ctx.lastReconcile[0].hargaKasir, 120);
  assert.strictEqual(ctx.lastReconcile[0].status, 'beda');
  assert.strictEqual(rendered, rows);
});
