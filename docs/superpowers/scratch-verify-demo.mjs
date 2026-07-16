// Scratch: verifikasi logika demo (sekali jalan). Bukan test permanen.
// Meniru fake localStorage + menyalin algoritma inti dari app.js untuk cek logika.
let store = {};
const localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
};
let fails = 0;
const ok = (cond, msg, extra) => { if (!cond) { fails++; console.error('FAIL:', msg, extra ?? ''); } };

const DEMO_KEYS = ['a', 'b', 'c'];
const DEMO_RR_KEY = 'kp_demo_rr';
function nextDemoIndex() {
  const i = (parseInt(localStorage.getItem(DEMO_RR_KEY) || '0', 10)) % DEMO_KEYS.length;
  localStorage.setItem(DEMO_RR_KEY, String((i + 1) % DEMO_KEYS.length));
  return i;
}
// Round-robin harus 0,1,2,0,1,2,0 (lanjut menembus "refresh" via store persist)
const seq = Array.from({ length: 7 }, () => nextDemoIndex());
ok(JSON.stringify(seq) === JSON.stringify([0, 1, 2, 0, 1, 2, 0]), 'RR seq', seq);

// Tier warna
const tier = (n) => (n > 40 ? 'hot' : n >= 30 ? 'warn' : 'ok');
ok(tier(0) === 'ok' && tier(29) === 'ok' && tier(30) === 'warn' && tier(40) === 'warn' && tier(41) === 'hot', 'tier');

// Day reset (count tersimpan {date,count})
function loadCount(today) {
  try { const o = JSON.parse(localStorage.getItem('c')); if (o && o.date === today) return o.count; } catch (_) {}
  return 0;
}
store['c'] = JSON.stringify({ date: '2026-6-28', count: 12 });
ok(loadCount('2026-6-28') === 12, 'same day keeps count');
ok(loadCount('2026-6-29') === 0, 'new day resets to 0');

// Cooldown left
const cdLeft = (last, now, win) => { const l = win - (now - last); return l > 0 ? l : 0; };
ok(cdLeft(1000, 3000, 5000) === 3000, 'cd active');
ok(cdLeft(1000, 7000, 5000) === 0, 'cd done');

// Gate: kuota >= limit → block quota; else cooldown; else ok
function gate(count, limit, cdMs) {
  if (count >= limit) return 'quota';
  if (cdMs > 0) return 'cooldown';
  return 'ok';
}
ok(gate(50, 50, 0) === 'quota', 'gate quota');
ok(gate(10, 50, 3000) === 'cooldown', 'gate cooldown');
ok(gate(10, 50, 0) === 'ok', 'gate ok');

if (fails === 0) console.log('OK: semua assert lolos');
else { console.error(`${fails} assert GAGAL`); process.exit(1); }
