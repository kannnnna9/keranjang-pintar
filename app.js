/* ============================================================
   Keranjang Pintar — app.js
   App statis, tanpa backend. Pola BYOK: API key Gemini disimpan
   di localStorage browser user. Satu jepret = satu label harga.
   Catatan: prefix localStorage 'bco_' dipertahankan (bukan diganti)
   agar data lama user (API key & riwayat) tetap terbaca setelah
   rename app dari "BelanjaCatat Online".
   ============================================================ */

'use strict';

/* ---------- Konfigurasi ----------
   MODEL di-PIN ke id stabil 'gemini-3.1-flash-lite' (bukan alias '-latest').
   Alasan: pengecekan kuota free-tier di AI Studio (akun Reza) menunjukkan
   hampir semua Flash dibatasi hanya 20 request per HARI (RPD) — tak cukup
   untuk satu sesi belanja (struk bisa 50 item = 50 scan). Gemini 3.1 Flash
   Lite satu-satunya yang longgar: RPM 15, RPD 500. Akurasi baca label juga
   sudah terbukti 100%. Alias '-latest' sengaja dihindari karena bisa hot-swap
   ke rilis ber-limit lebih ketat (mis. 'gemini-flash-latest' kini menunjuk
   Gemini 3.5 Flash yang dibatasi 20 RPD) tanpa diduga. */
const MODEL = 'gemini-3.1-flash-lite';
// Batas kuota free-tier model di atas (sumber: AI Studio Rate Limit, 2026-06).
const RPM_LIMIT = 15;   // request per menit
const RPD_LIMIT = 500;  // request per hari
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const KEY_STORAGE = 'bco_api_key';
const HISTORY_STORAGE = 'bco_history';
const CART_STORAGE = 'bco_cart';
const SESSION_STORAGE = 'bco_session';

/* ---------- Demo Mode (v2.1.1 via proxy) ----------
   Demo tidak lagi menyimpan API key di browser. Scan demo dikirim ke Worker,
   lalu Worker yang memegang key server-side, membatasi kuota, dan merotasi
   akun demo. */
const DEMO_AVAILABLE = true;
const DEMO_PROXY_URL = 'https://keranjang-pintar-demo.keranjang-pintar.workers.dev/v1/demo/scan';
const DEMO_DEVICE_KEY = 'kp_demo_device_id';
const DEMO_DAILY_LIMIT = 50;     // keputusan 1: 50 scan/device/hari
const DEMO_COOLDOWN_MS = 5000;   // 1 scan / 5 detik / device (cegah RPM 429)

const DEMO_SCAN_KEY = 'kp_demo_scan_count'; // {date, count} scan sukses hari ini (reset harian)
const ACTIVE_MODE_KEY = 'kp_active_mode';    // 'demo' | 'own_key'
const DEMO_COOLDOWN_KEY = 'kp_demo_cooldown';// timestamp scan demo terakhir

/* ---------- Mode aktif ---------- */
function getActiveMode() { return localStorage.getItem(ACTIVE_MODE_KEY) || ''; }
function setActiveMode(m) { localStorage.setItem(ACTIVE_MODE_KEY, m); }

/* ---------- Kuota lokal demo (per device, reset harian) ----------
   Disimpan {date, count}; beda hari → count dianggap 0 (reset). Pakai todayKey()
   yang sama dengan RPD agar batas hari konsisten. */
function loadDemoCount() {
  try {
    const o = JSON.parse(localStorage.getItem(DEMO_SCAN_KEY));
    if (o && o.date === todayKey()) return o.count;
  } catch (_) {}
  return 0;
}

function cacheDemoQuota(quota) {
  if (!quota || typeof quota.deviceUsed !== 'number') return;
  localStorage.setItem(DEMO_SCAN_KEY, JSON.stringify({ date: todayKey(), count: quota.deviceUsed }));
}

/* ---------- Cooldown demo ----------
   Sisa milidetik sebelum boleh scan lagi (0 = boleh). */
function demoCooldownLeft() {
  const last = parseInt(localStorage.getItem(DEMO_COOLDOWN_KEY) || '0', 10);
  const left = DEMO_COOLDOWN_MS - (Date.now() - last);
  return left > 0 ? left : 0;
}
let demoCdTimer = null;
function markDemoCooldown() {
  localStorage.setItem(DEMO_COOLDOWN_KEY, String(Date.now()));
  // Ticker 1 detik supaya hitung mundur di badge turun mulus, lalu mati sendiri.
  if (demoCdTimer) clearInterval(demoCdTimer);
  demoCdTimer = setInterval(() => {
    renderQuota();
    if (demoCooldownLeft() <= 0) { clearInterval(demoCdTimer); demoCdTimer = null; }
  }, 1000);
}

/* ---------- Gate scan demo ----------
   Cek kuota lalu cooldown. Return {ok} atau {ok:false, reason, waitSec}. */
function demoGate() {
  if (loadDemoCount() >= DEMO_DAILY_LIMIT) return { ok: false, reason: 'quota' };
  const left = demoCooldownLeft();
  if (left > 0) return { ok: false, reason: 'cooldown', waitSec: Math.ceil(left / 1000) };
  return { ok: true };
}

/* Tangani gate demo gagal. quota → sheet aksi; cooldown → pesan singkat di
   elemen target (#cam-error saat di kamera). Return true bila boleh scan. */
function passDemoGateOr(showCooldownIn) {
  if (getActiveMode() !== 'demo') return true;
  const g = demoGate();
  if (g.ok) return true;
  if (g.reason === 'quota') { openSheet('sheet-demo-block'); return false; }
  if (showCooldownIn) {
    const el = $(showCooldownIn);
    el.textContent = `Tunggu sebentar… ${g.waitSec} detik.`;
    el.hidden = false;
  }
  return false;
}

function getDemoDeviceId() {
  let id = localStorage.getItem(DEMO_DEVICE_KEY);
  if (id) return id;
  id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  localStorage.setItem(DEMO_DEVICE_KEY, id);
  return id;
}

// Versi aplikasi. Satu sumber kebenaran: teks versi di halaman pengaturan
// diisi dari sini saat init, jadi cukup ubah angka ini tiap rilis.
const APP_VERSION = 'v2.7.0';
const NOTE_STORAGE = 'kp_shopping_note';
const NOTE_MAX_ITEMS = 100;
const NOTE_MAX_TEXT = 80;

function parseShoppingNoteText(input) {
  return String(input || '').split(/\n/).map((line) => line.replace(/^\s*(?:\[[ xX]\]\s*|(?:\(\d+\)|\d+[.)]|[-•*+])\s*)+/, '').trim().slice(0, NOTE_MAX_TEXT)).filter(Boolean).slice(0, NOTE_MAX_ITEMS);
}

const PROMPT = [
  'Baca label harga ini. Balas HANYA JSON.',
  'Field: nama, harga, promoTipe, promoQty, beliQty, gratisQty, hargaPromo,',
  'hargaNormal, syarat, labelWarna, semuaHarga.',
  'ATURAN UTAMA: jangan menghitung apa pun. Laporkan hanya angka yang TERTULIS di label.',
  'harga = harga yang tertulis paling menonjol.',
  'semuaHarga = daftar SEMUA angka harga yang terbaca di label, apa adanya.',
  "labelWarna = warna dominan latar label: 'kuning' | 'merah' | 'putih' | 'lain'.",
  'syarat = kutip PERSIS teks syarat promo bila ada, misalnya "Khusus Member AlfaGift",',
  '"Beli 2 Gratis 1", "Periode 1-15 Juli". Kosongkan bila tak ada teks syarat.',
  'Pilih promoTipe:',
  "'none' = satu harga saja, tak ada tanda promo.",
  "'diskon' = ada harga coret + harga baru, TANPA syarat keanggotaan;",
  'hargaPromo = harga baru, hargaNormal = harga coret.',
  "'member' = HANYA bila label menuliskan syarat kartu/keanggotaan",
  '(Member, Kartu, AlfaGift, Ponta, JakOne, Bonus Card);',
  'hargaPromo = harga member, hargaNormal = harga non-member.',
  "'bulk' = pola 'N item = harga' atau 'N pcs Rp X';",
  'promoQty = N, hargaPromo = harga paket, hargaNormal = harga satuan bila tertera.',
  "'gratis' = pola 'Beli N Gratis M'; beliQty = N, gratisQty = M,",
  'hargaNormal = harga satuan. JANGAN hitung harga paketnya.',
  'PENTING: harga coret TIDAK otomatis berarti member.',
  'Tanpa tulisan keanggotaan, harga coret itu diskon.',
  'Field yang tak dipakai isi 0 atau string kosong.',
  'Angka tanpa titik/koma. Contoh: 16500 bukan 16.500.',
].join(' ');

const RECONCILE_PROMPT = [
  'Kamu diberi FOTO STRUK KASIR dan DAFTAR BELANJA.',
  'TUGASMU MENYALIN, BUKAN MENILAI. JANGAN menghitung apa pun.',
  'Laporkan hanya angka yang TERTULIS di struk.',
  'Salin SEMUA baris struk dalam urutan tercetak dari atas ke bawah, tanpa',
  'melewatkan baris apa pun — termasuk baris potongan, total, dan pembayaran.',
  'urut = nomor urutan baris, mulai dari 1.',
  'peran tiap baris:',
  "'barang' = baris produk.",
  "'potongan' = baris yang MENGURANGI harga (HEMAT, DISC, DISKON, PROMO,",
  'VOUCHER, SUBSIDI, apa pun namanya).',
  "'total' = baris penjumlahan (Sub Total, TOTAL, JUMLAH BAYAR).",
  "'penyesuaian' = Pembulatan dan sejenisnya.",
  "'pembayaran' = tunai, kembalian, kartu, QRIS, e-wallet.",
  "'lain' = header kolom, alamat toko, NPWP, nomor kasir, teks promosi.",
  'Baris potongan biasanya TIDAK punya nama produk dan milik baris barang di',
  'ATASNYA. Jangan mengarang nama untuknya — biarkan nama kosong.',
  'qty BOLEH NEGATIF bila kasir membatalkan barang; salin apa adanya,',
  'termasuk total yang negatif.',
  'harga = kolom harga satuan bila tercetak. total = kolom total baris bila',
  'tercetak. Isi 0 bila tak tercetak.',
  'cocokKe = indeks i dari DAFTAR BELANJA yang paling cocok dengan baris barang ini.',
  'Nama di struk sering disingkat atau berupa kode, misalnya "IMG SPESIAL 85"',
  '= "Indomie Goreng Spesial 85g".',
  'Isi -1 bila tak ada yang cocok — JANGAN dipaksa cocok.',
  'cocokKe hanya untuk peran barang; peran lain selalu -1.',
  'Angka tanpa titik/koma. Contoh: 16500 bukan 16.500.',
  'Balas HANYA JSON array.',
].join(' ');

/* ---------- State ---------- */
let cart = [];          // [{ nama, harga, qty }]
let pendingPromo = null; // promo{} yang akan ditempel ke item saat Tambah (null = tanpa promo)
let stream = null;      // MediaStream kamera aktif
let zoomAktif = 1;      // tingkat zoom (1|2|4) yang sedang dipilih user
let zoomCaps = null;    // MediaTrackCapabilities.zoom dari kamera yang sedang hidup
let lastShot = null;    // base64 JPEG hasil jepret terakhir (untuk "Ulangi")
let cartSessionId = null; // id sesi belanja berjalan untuk grup foto F2
let editIndex = -1;     // indeks item keranjang yang sedang diedit (-1 = tidak ada)
let sessionSaved = false; // true bila komposisi keranjang ini sudah masuk riwayat
let budget = 0;         // anggaran sesi ini (Rp); 0 = belum diatur. Per sesi, reset saat belanja baru.
let lastReconcile = null; // hasil reconcileHitung terakhir (untuk render ulang)
let lastBaris = null;     // transkripsi struk dari AI (dipakai hitung ulang lokal)
let lastGrup = null;      // grupKeranjang saat rekonsiliasi dijalankan
let shoppingNote = { items: [], updatedAt: 0 };

/* ---------- Keranjang anti-hilang ----------
   Keranjang & anggaran sesi disimpan ke localStorage tiap kali berubah,
   lalu dipulihkan saat app dibuka lagi. Ini menutup celah "tutup tab /
   refresh / HP restart = keranjang lenyap". Catatan keterbatasan: karena
   localStorage termasuk "data situs", menghapus cache/data situs di browser
   TETAP menghapus keranjang ini (sama seperti API key & riwayat) — di luar
   kendali app statis tanpa backend. */
function persistCart() {
  try {
    localStorage.setItem(CART_STORAGE, JSON.stringify({ cart, budget, sessionSaved }));
  } catch (_) {} // kuota localStorage penuh / mode privat → biarkan, jangan ganggu belanja
}

function restoreCart() {
  try {
    const o = JSON.parse(localStorage.getItem(CART_STORAGE));
    if (o && Array.isArray(o.cart)) {
      cart = o.cart;
      budget = Number(o.budget) || 0;
      sessionSaved = !!o.sessionSaved;
    }
  } catch (_) {} // data rusak → mulai dengan keranjang kosong, jangan blokir app
  cartSessionId = localStorage.getItem(SESSION_STORAGE) || null;
}

function ensureSessionId() {
  if (!cartSessionId) {
    cartSessionId = 's_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    localStorage.setItem(SESSION_STORAGE, cartSessionId);
  }
  return cartSessionId;
}

/* ---------- Util DOM ---------- */
const $ = (id) => document.getElementById(id);
const rupiah = (n) => 'Rp ' + (Number(n) || 0).toLocaleString('id-ID');

function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => (s.hidden = true));
  $(id).hidden = false;
  renderNoteFabVisibility();
}
function openSheet(id) { $(id).hidden = false; renderNoteFabVisibility(); }
function closeSheet(id) { $(id).hidden = true; renderNoteFabVisibility(); }
function showToast(message) { const el = $('toast'); if (!el) return; el.textContent = message; el.hidden = false; clearTimeout(showToast.timer); showToast.timer = setTimeout(() => { el.hidden = true; }, 2800); }
function persistShoppingNote() { shoppingNote.updatedAt = Date.now(); try { localStorage.setItem(NOTE_STORAGE, JSON.stringify(shoppingNote)); } catch (_) { showToast('Catatan mungkin tak tersimpan'); } }
function restoreShoppingNote() { try { const data = JSON.parse(localStorage.getItem(NOTE_STORAGE)); if (data && Array.isArray(data.items)) shoppingNote = { items: data.items.filter((it) => it && typeof it.text === 'string').slice(0, NOTE_MAX_ITEMS), updatedAt: Number(data.updatedAt) || 0 }; } catch (_) { shoppingNote = { items: [], updatedAt: 0 }; } }
function noteRemaining() { return shoppingNote.items.filter((it) => !it.checked).length; }
function renderShoppingNote() { const list = $('note-list'); if (!list) return; list.innerHTML = ''; shoppingNote.items.forEach((item) => { const li = document.createElement('li'); li.className = 'note-item' + (item.checked ? ' is-checked' : ''); li.innerHTML = '<button class="note-row" type="button"><input type="checkbox" tabindex="-1"><span></span></button><button class="note-delete" type="button" aria-label="Hapus item">×</button>'; const row = li.querySelector('.note-row'); row.querySelector('input').checked = !!item.checked; row.querySelector('span').textContent = item.text; row.addEventListener('click', () => { item.checked = !item.checked; persistShoppingNote(); renderShoppingNote(); }); li.querySelector('.note-delete').addEventListener('click', () => { shoppingNote.items = shoppingNote.items.filter((it) => it.id !== item.id); persistShoppingNote(); renderShoppingNote(); }); list.appendChild(li); }); $('note-empty').hidden = shoppingNote.items.length > 0; $('note-progress').textContent = `${shoppingNote.items.length - noteRemaining()}/${shoppingNote.items.length} kebeli`; const badge = $('note-badge'); badge.hidden = noteRemaining() === 0; badge.textContent = noteRemaining(); }
function addShoppingNoteText(text) { let parsed; try { parsed = parseShoppingNoteText(text); } catch (_) { showToast('Teks tidak bisa dibaca'); return; } const room = NOTE_MAX_ITEMS - shoppingNote.items.length; const added = parsed.slice(0, Math.max(0, room)); added.forEach((value) => shoppingNote.items.push({ id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`, text: value, checked: false, createdAt: Date.now() })); if (parsed.length > added.length) showToast(`Catatan penuh, ${parsed.length - added.length} item terakhir tidak ditambahkan`); if (added.length) persistShoppingNote(); renderShoppingNote(); }
function clearShoppingNote() { if (!shoppingNote.items.length || confirm('Bersihkan semua catatan?')) { shoppingNote.items = []; persistShoppingNote(); renderShoppingNote(); } }
function openShoppingNote() { renderShoppingNote(); openSheet('sheet-shopping-note'); }
function finalizeShopping(noteAction) { shoppingNote.items = noteAction === 'keep' ? shoppingNote.items.filter((it) => !it.checked).map((it) => ({ ...it, checked: false })) : []; persistShoppingNote(); renderShoppingNote(); closeSheet('sheet-note-finish'); openSheet('sheet-summary'); }
function maybeFinishWithNote() { if (shoppingNote.items.length && noteRemaining()) { $('note-finish-count').textContent = noteRemaining(); $('note-finish-items').textContent = shoppingNote.items.filter((it) => !it.checked).map((it) => it.text).join(', '); openSheet('sheet-note-finish'); } else { shoppingNote.items = []; persistShoppingNote(); openSheet('sheet-summary'); } }
function renderNoteFabVisibility() { const fab = $('note-fab'); if (!fab) return; const dashboard = !$('screen-dashboard').hidden; const anySheet = [...document.querySelectorAll('.sheet-backdrop')].some((el) => !el.hidden); fab.hidden = !dashboard || anySheet; if (!fab.hidden && typeof armNoteIdle === 'function') armNoteIdle(); }
let noteIdleTimer = null;
function armNoteIdle() {
  const fab = $('note-fab');
  if (!fab || fab.hidden) return;
  fab.classList.remove('is-idle');
  clearTimeout(noteIdleTimer);
  noteIdleTimer = setTimeout(() => fab.classList.add('is-idle'), 3000);
}
function initNoteFab() {
  const fab = $('note-fab');
  if (!fab) return;
  fab.addEventListener('click', () => { openShoppingNote(); armNoteIdle(); });
  const list = $('cart-list');
  if (list) list.addEventListener('scroll', armNoteIdle, { passive: true });
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.sheet') && !e.target.closest('.screen-camera')) armNoteIdle(); }, { passive: true });
  localStorage.removeItem('kp_note_fab_pos');
  renderNoteFabVisibility();
}


/* ============================================================
   IKON (SVG line, satu sumber kebenaran)
   Ganti emoji warna-warni dengan ikon garis bergaya seragam yang mewarisi
   warna teks (stroke=currentColor) → otomatis ikut palet "Ungu Lembut".
   Statis: tombol ber-atribut [data-icon] dihidrasi saat load.
   Dinamis: dipanggil lewat svgIcon() di render kuota, item, & hint.
   ============================================================ */
const ICONS = {
  clock:    '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3.2 1.8"/>',
  settings: '<path d="M20 7h-8.5"/><path d="M12.5 17H4"/><circle cx="16.5" cy="17" r="2.6"/><circle cx="7.5" cy="7" r="2.6"/>',
  download: '<path d="M12 3.5v11"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M4.5 20.5h15"/>',
  trash:    '<path d="M3.5 6.5h17"/><path d="M9 6.5V4.5h6v2"/><path d="M6 6.5l1 13a1.6 1.6 0 0 0 1.6 1.5h6.8A1.6 1.6 0 0 0 17 19.5l1-13"/><path d="M10 10.5v7M14 10.5v7"/>',
  camera:   '<path d="M14.5 4.5h-5L8 7H4.2A2.2 2.2 0 0 0 2 9.2v9.3A2.2 2.2 0 0 0 4.2 20.7h15.6A2.2 2.2 0 0 0 22 18.5V9.2A2.2 2.2 0 0 0 19.8 7H16z"/><circle cx="12" cy="13.2" r="3.6"/>',
  image:    '<rect x="3" y="3.5" width="18" height="17" rx="2.4"/><circle cx="8.5" cy="9" r="1.6"/><path d="m21 15.5-5-5L4.5 21"/>',
  share:    '<circle cx="18" cy="5.5" r="2.8"/><circle cx="6" cy="12" r="2.8"/><circle cx="18" cy="18.5" r="2.8"/><path d="m8.5 13.4 7 3.7M15.5 6.9l-7 3.7"/>',
  zap:      '<path d="M13 2.5 4.5 13.5H11l-1 8L19.5 10H13z"/>',
  alert:    '<path d="M10.3 4 1.9 18.2A2 2 0 0 0 3.6 21.2h16.8a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0Z"/><path d="M12 9.5v4.5M12 17.5h.01"/>',
  timer:    '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 10v3.5l2.4 1.4"/><path d="M9.5 2.5h5"/>',
  tag:      '<path d="M3 7v4.7a2 2 0 0 0 .6 1.4l7.6 7.6a2 2 0 0 0 2.8 0l5.3-5.3a2 2 0 0 0 0-2.8L11.7 5a2 2 0 0 0-1.4-.6H5a2 2 0 0 0-2 2Z"/><circle cx="7.5" cy="7.5" r="1.3"/>',
  cart:     '<circle cx="9.5" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2.5 3.5H5l2.3 11.4a1.6 1.6 0 0 0 1.6 1.3h8.5a1.6 1.6 0 0 0 1.6-1.3L21.5 7.5H6"/>',
  close:    '<path d="M6 6l12 12M18 6 6 18"/>',
  receipt:  '<path d="M5 3.5v17l2-1 2 1 2-1 2 1 2-1 2 1v-17l-2 1-2-1-2 1-2-1-2 1Z"/><path d="M9 8.5h6M9 12.5h6"/>',
  'note-edit': '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8.5"/><path d="M8 8.5h5"/><path d="M8 12.5h4"/><path d="M8 16.5h6"/><path d="M17.6 2.6a1.9 1.9 0 0 1 2.8 2.8l-5.8 5.8-3.2.4.4-3.2Z"/>',
};
function svgIcon(name, size = 20) {
  return `<svg class="ic" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}
// Hidrasi tombol statis: sisipkan SVG di awal (teks label, kalau ada, tetap).
function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    const size = el.classList.contains('empty') ? 40 : (el.dataset.iconSize ? +el.dataset.iconSize : 20);
    el.insertAdjacentHTML('afterbegin', svgIcon(el.dataset.icon, size));
    el.removeAttribute('data-icon'); // tandai sudah dihidrasi → aman dipanggil ulang
  });
}

/* ============================================================
   INDIKATOR KUOTA (rate-limit)
   Lacak request ke Gemini agar user tahu sisa jatah sebelum kena 429.
   RPM: timestamp tiap request, yang lebih lama dari 60 detik dibuang
   (in-memory, hilang saat reload — tak apa, jendelanya cuma semenit).
   RPD: dihitung & disimpan di localStorage, reset otomatis tiap ganti hari.
   ============================================================ */
const RPD_STORAGE = 'bco_rpd';
const RPM_STORAGE = 'bco_rpm';
let reqTimes = [];     // timestamp (ms) request dalam jendela 60 detik
let limitHit = false;  // true bila request terakhir kena 429

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
function loadRpd() {
  try {
    const o = JSON.parse(localStorage.getItem(RPD_STORAGE));
    if (o && o.date === todayKey()) return o.count;
  } catch (_) {}
  return 0; // tak ada catatan / beda hari → mulai dari 0 (reset harian)
}
function bumpRpd() {
  localStorage.setItem(RPD_STORAGE, JSON.stringify({ date: todayKey(), count: loadRpd() + 1 }));
}

// RPM ikut di-persist (bukan in-memory saja) supaya refresh/tutup-tab di
// tengah belanja tak menyetel ulang hitungan ke "⚡ Siap" yang menyesatkan —
// timestamp lewat 60 detik tetap dibuang saat dimuat, jadi jendelanya akurat.
function saveReqTimes() {
  try { localStorage.setItem(RPM_STORAGE, JSON.stringify(reqTimes)); } catch (_) {}
}
function loadReqTimes() {
  try {
    const arr = JSON.parse(localStorage.getItem(RPM_STORAGE));
    if (Array.isArray(arr)) reqTimes = arr;
  } catch (_) {}
  pruneReqTimes(); // buang yang sudah lewat 60 detik sejak terakhir dibuka
}

// Dipanggil tiap satu request dikirim ke Gemini (termasuk tiap retry).
function recordRequest() {
  reqTimes.push(Date.now());
  saveReqTimes();
  bumpRpd();
  limitHit = false; // request baru terkirim → bersihkan penanda limit lama
  renderQuota();
}
function markLimit() { limitHit = true; renderQuota(); }

function pruneReqTimes() {
  const cut = Date.now() - 60000;
  const before = reqTimes.length;
  reqTimes = reqTimes.filter((t) => t > cut);
  if (reqTimes.length !== before) saveReqTimes(); // simpanan ikut rapi saat menyusut
}

function renderQuota() {
  pruneReqTimes();
  const el = $('quota-indicator');
  if (el) {
    if (getActiveMode() === 'demo') {
      renderDemoBadge(el);
    } else if (limitHit) {
      el.innerHTML = svgIcon('alert', 16) + '<span>Limit</span>';
      el.className = 'quota quota-limit';
    } else if (reqTimes.length === 0) {
      el.innerHTML = svgIcon('zap', 16) + '<span>Siap</span>';
      el.className = 'quota quota-ok';
    } else {
      el.innerHTML = svgIcon('timer', 16) + `<span>${reqTimes.length}/${RPM_LIMIT} RPM</span>`;
      el.className = 'quota quota-busy';
    }
  }
  const rpd = $('rpd-counter');
  if (rpd) rpd.textContent = `${loadRpd()}/${RPD_LIMIT}`;
}

/* Badge mode demo: "Demo · N/50 scan" (+ "tunggu N dtk" saat cooldown).
   Tier warna: hijau <30, kuning 30-40, merah >40 (spec §4.2). */
function renderDemoBadge(el) {
  const n = loadDemoCount();
  const left = demoCooldownLeft();
  let tier = 'demo-ok';
  if (n > 40) tier = 'demo-hot';
  else if (n >= 30) tier = 'demo-warn';
  const cd = left > 0 ? `, tunggu ${Math.ceil(left / 1000)} dtk` : '';
  el.innerHTML = svgIcon('cart', 16) + `<span>Demo · ${n}/${DEMO_DAILY_LIMIT} scan${cd}</span>`;
  el.className = 'quota quota-demo ' + tier;
}

/* ============================================================
   INIT
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  wireEvents();
  purgeExpiredPhotos();
  hydrateIcons(); // sisipkan SVG ke semua tombol [data-icon] statis
  applyDemoAvailability(); // v2.0.1: sembunyikan jalan-masuk demo bila DEMO_AVAILABLE=false
  const ver = $('app-version');
  if (ver) ver.textContent = APP_VERSION;
  // Pulihkan hitungan RPM dari sesi sebelumnya (timestamp >60s dibuang),
  // lalu refresh berkala supaya angkanya turun sendiri tanpa nunggu aksi user.
  loadReqTimes();
  restoreShoppingNote();
  renderShoppingNote();
  renderQuota();
  initNoteFab();
  setInterval(renderQuota, 5000);
  // Pilih layar awal:
  // - User lama (punya bco_api_key) → migrasi senyap ke own_key, langsung
  //   dashboard tanpa onboarding (§3.4) — jangan kagetkan/putuskan akses.
  // - User demo lama (mode tersimpan 'demo') → dashboard demo HANYA bila demo
  //   masih aktif; sejak v2.0.1 demo mati → bersihkan mode & arahkan ke Welcome
  //   supaya user pasang API key sendiri (key demo lama sudah dicabut Google).
  // - Selain itu (benar-benar baru) → layar Selamat Datang.
  if (getKey()) {
    if (getActiveMode() !== 'own_key') setActiveMode('own_key');
    restoreCart();
    enterDashboard();
  } else if (DEMO_AVAILABLE && getActiveMode() === 'demo') {
    restoreCart();
    enterDashboard();
  } else {
    if (getActiveMode() === 'demo') setActiveMode(''); // buang mode demo basi
    showScreen('screen-welcome');
  }

  // Daftarkan service worker (PWA: installable + app shell jalan offline).
  // Gagal daftar = senyap; app tetap berjalan normal tanpa SW.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
});

async function purgeExpiredPhotos() {
  if (!window.PhotoDB || !window.Retention) return;
  try {
    const all = await window.PhotoDB.getAllPhotos();
    const expiredIds = window.Retention.pickExpired(all, Date.now());
    for (const id of expiredIds) await window.PhotoDB.deletePhoto(id);
  } catch (_) {}
}

function wireEvents() {
  // Welcome / onboarding
  $('btn-start-demo').addEventListener('click', startDemo);
  $('btn-start-ownkey').addEventListener('click', () => showScreen('screen-setup'));

  // Setup
  $('btn-save-key').addEventListener('click', saveKey);
  $('api-key-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveKey();
  });

  // Dashboard
  $('btn-add-item').addEventListener('click', openCamera);
  $('btn-manual').addEventListener('click', inputManual);
  $('btn-finish').addEventListener('click', finishShopping);
  $('btn-note-add').addEventListener('click', () => { addShoppingNoteText($('note-input').value); $('note-input').value = ''; });
  $('btn-note-clear').addEventListener('click', clearShoppingNote);
  $('btn-note-keep').addEventListener('click', () => finalizeShopping('keep'));
  $('btn-note-finish-clear').addEventListener('click', () => finalizeShopping('clear'));
  $('btn-settings').addEventListener('click', () => { renderQuota(); renderSettings(); openSheet('sheet-settings'); });
  const btnScanReport = $('btn-scan-report');
  if (btnScanReport) btnScanReport.addEventListener('click', () => {
    closeSheet('sheet-result');
    renderQuota(); renderSettings();
    openSheet('sheet-settings');
  });
  $('btn-history').addEventListener('click', openHistory);

  // Uji galeri (dari pengaturan): tutup sheet dulu, lalu pilih gambar dari
  // penyimpanan → pipeline scan yang sama.
  $('btn-gallery').addEventListener('click', () => {
    closeSheet('sheet-settings');
    $('gallery-input').click();
  });
  $('gallery-input').addEventListener('change', onGalleryPick);

  // Uji galeri dari dashboard demo mode
  $('btn-gallery-demo').addEventListener('click', () => {
    $('gallery-input').click();
  });

  // Riwayat
  $('btn-history-back').addEventListener('click', enterDashboard);
  $('btn-clear-history').addEventListener('click', clearHistory);
  $('btn-export-csv').addEventListener('click', exportHistoryCsv);
  $('btn-share-hist').addEventListener('click', shareHistory);
  $('btn-del-hist').addEventListener('click', deleteSession);

  // Ringkasan: bagikan daftar belanja saat ini
  $('btn-share-summary').addEventListener('click', shareSummary);
  $('btn-reconcile').addEventListener('click', onReconcileClick);
  $('receipt-file').addEventListener('change', onReceiptPicked);
  $('btn-reconcile-close').addEventListener('click', enterDashboard);
  $('btn-reconcile-done').addEventListener('click', enterDashboard);
  $('btn-photo-close').addEventListener('click', () => closeSheet('sheet-photo'));

  // Edit item keranjang
  $('btn-edit-save').addEventListener('click', saveEdit);
  $('btn-edit-cancel').addEventListener('click', () => closeSheet('sheet-edit'));

  // Stepper jumlah (qty) di sheet hasil scan & sheet edit
  $('res-qty-minus').addEventListener('click', () => bumpQty('res-qty', -1));
  $('res-qty-plus').addEventListener('click', () => bumpQty('res-qty', +1));
  $('edit-qty-minus').addEventListener('click', () => bumpQty('edit-qty', -1));
  $('edit-qty-plus').addEventListener('click', () => bumpQty('edit-qty', +1));

  // Anggaran belanja (per sesi)
  $('budget-bar').addEventListener('click', openBudget);
  $('btn-budget-save').addEventListener('click', saveBudget);
  $('btn-budget-clear').addEventListener('click', clearBudget);

  // Kamera
  $('btn-capture').addEventListener('click', capture);
  $('btn-back').addEventListener('click', enterDashboard);

  // Hasil scan / input manual
  $('btn-add').addEventListener('click', addToCart);
  $('res-harga').addEventListener('input', syncAddEnabled);
  $('btn-retry').addEventListener('click', retryScan);

  // Ringkasan
  $('btn-close-summary').addEventListener('click', () => closeSheet('sheet-summary'));
  $('btn-new').addEventListener('click', newShopping);

  // Pengaturan
  $('btn-change-key').addEventListener('click', changeKey);
  $('btn-to-ownkey').addEventListener('click', () => { closeSheet('sheet-settings'); showScreen('screen-setup'); });

  // Sheet kuota demo habis
  $('btn-demo-manual').addEventListener('click', () => { closeSheet('sheet-demo-block'); inputManual(); });
  $('btn-demo-ownkey').addEventListener('click', () => { closeSheet('sheet-demo-block'); stopCamera(); showScreen('screen-setup'); });

  // Tombol tutup generik (data-close="id")
  document.querySelectorAll('[data-close]').forEach((b) => {
    b.addEventListener('click', () => closeSheet(b.dataset.close));
  });

  // Klik backdrop untuk menutup sheet.
  document.querySelectorAll('.sheet-backdrop').forEach((bd) => {
    bd.addEventListener('click', (e) => {
      if (e.target !== bd) return;
      // Hasil scan SENGAJA dikecualikan: jangan tutup lewat ketuk backdrop,
      // supaya item yang sudah discan tak hilang gara-gara salah pencet di
      // luar sheet (area gelap menutupi tombol histori/pengaturan di belakang).
      // Untuk membuang hasil, user menekan "Batal" secara eksplisit.
      if (bd.id === 'sheet-result') return;
      if (bd.id === 'sheet-note-finish') return;
      bd.hidden = true; renderNoteFabVisibility();
    });
  });
}

/* ============================================================
   API KEY (BYOK)
   ============================================================ */
function getKey() { return localStorage.getItem(KEY_STORAGE) || ''; }

function saveKey() {
  const val = $('api-key-input').value.trim();
  const err = $('setup-error');
  if (!val) {
    err.textContent = 'API key tidak boleh kosong.';
    err.hidden = false;
    return;
  }
  localStorage.setItem(KEY_STORAGE, val);
  setActiveMode('own_key'); // pilih/menetapkan mode key sendiri
  err.hidden = true;
  enterDashboard();
}

function changeKey() {
  closeSheet('sheet-settings');
  stopCamera();
  $('api-key-input').value = getKey();
  showScreen('screen-setup');
}

/* Mulai pakai Demo (dari layar Welcome). Set mode, pulihkan keranjang bila ada,
   masuk dashboard. Sejak v2.0.1 demo mati → fallback ke setup key sendiri. */
function startDemo() {
  if (!DEMO_AVAILABLE) { showScreen('screen-setup'); return; }
  setActiveMode('demo');
  restoreCart();
  enterDashboard();
}

/* v2.0.1: bila demo dimatikan (DEMO_AVAILABLE=false), sembunyikan semua jalan
   masuk demo dan jadikan "Pakai API Key Sendiri" CTA utama di layar Welcome.
   Dikontrol satu flag → tinggal balik ke true saat proxy serverless siap. */
function applyDemoAvailability() {
  if (DEMO_AVAILABLE) return;
  const demoBtn = $('btn-start-demo');
  if (demoBtn) demoBtn.hidden = true;            // Welcome: sembunyikan tombol Demo
  const galleryDemo = $('btn-gallery-demo');
  if (galleryDemo) galleryDemo.hidden = true;    // Dashboard: sembunyikan galeri demo
  const own = $('btn-start-ownkey');
  if (own) {
    own.classList.remove('link-btn', 'link-btn-center');
    own.classList.add('btn', 'btn-primary', 'welcome-btn');
    own.textContent = 'Pakai API Key Sendiri'; // promosikan BYOK jadi CTA utama (teks-link asalnya cuma opsi kedua)
  }
}

/* Isi sheet Pengaturan sesuai mode aktif: tampilkan blok demo atau own_key. */
function renderSettings() {
  const demo = getActiveMode() === 'demo';
  $('settings-demo').hidden = !demo;
  $('settings-ownkey').hidden = demo;
  if (demo) $('demo-count-label').textContent = `${loadDemoCount()}/${DEMO_DAILY_LIMIT}`;
}

/* ============================================================
   NAVIGASI
   ============================================================ */
function enterDashboard() {
  stopCamera();
  showScreen('screen-dashboard');
  renderCart();
  renderQuota();
  // Tampilkan/sembunyikan tombol galeri demo berdasarkan mode aktif
  const galleryDemo = $('btn-gallery-demo');
  if (galleryDemo) galleryDemo.hidden = getActiveMode() !== 'demo';
}

function openCamera() {
  showScreen('screen-camera');
  startCamera();
}

/* ============================================================
   KAMERA
   ============================================================ */
/* ==== CAMERA ZOOM (start) ==== */
/* Tangga zoom + baca-balik. Sengaja bebas DOM dan bebas MediaStream supaya bisa
   diuji di node:vm tanpa kamera. Prinsipnya sama dengan PROMO RULES: yang bisa
   dites di meja tidak dititipkan ke hardware. */

const ZOOM_TANGGA = [1, 2, 4];

// caps = MediaTrackCapabilities.zoom. Satuannya implementation-specific: ada HP
// yang melaporkan {min:1,max:10}, ada yang {min:100,max:400} (100 = tanpa zoom).
// Yang dijamin spesifikasi cuma `min` = tanpa zoom, jadi tangga "×" diturunkan
// dari min sebagai patokan 1× — bukan dari angka mutlak.
// Kembalikan [] artinya: sembunyikan baris tombol.
function zoomLevels(caps) {
  if (!caps) return [];
  const min = Number(caps.min), max = Number(caps.max);
  if (!isFinite(min) || !isFinite(max) || max <= min) return [];
  const base = min > 0 ? min : 1; // min:0 → satuan ambigu, anggap pengali mutlak
  const out = [];
  for (const x of ZOOM_TANGGA) if (base * x <= max) out.push({ x, nilai: base * x });
  return out.length > 1 ? out : []; // cuma 1× = tak ada gunanya
}

// applyConstraints({advanced}) bersifat best-effort: permintaan yang diabaikan
// TIDAK melempar error. Jadi baca-balik getSettings().zoom adalah satu-satunya
// cara tahu permintaannya benar-benar dituruti.
function zoomDiterima(diminta, aktual, step) {
  if (aktual == null) return true; // HP tak melaporkan → percaya applyConstraints
  const toleransi = Number(step) > 0 ? Number(step) : 1e-6;
  return Math.abs(Number(aktual) - Number(diminta)) <= toleransi;
}
/* ==== CAMERA ZOOM (end) ==== */

// Terapkan zoom ke kamera. Pakai `advanced` (best-effort) supaya permintaan yang
// tak didukung tidak mematikan stream; hasilnya diverifikasi lewat baca-balik.
async function applyZoom(track, nilai, step) {
  try { await track.applyConstraints({ advanced: [{ zoom: nilai }] }); }
  catch (_) { return false; }
  return zoomDiterima(nilai, track.getSettings ? track.getSettings().zoom : null, step);
}

function markZoomAktif() {
  const row = $('zoom-row');
  if (!row) return;
  row.querySelectorAll('.zoom-btn').forEach((b) => {
    b.setAttribute('aria-pressed', Number(b.dataset.x) === zoomAktif ? 'true' : 'false');
  });
}

async function onZoomTap(x, nilai) {
  if (!stream) return;
  const mediaStream = stream;
  const track = mediaStream.getVideoTracks()[0];
  if (!track) return;
  const ok = await applyZoom(track, nilai, zoomCaps && zoomCaps.step);
  if (stream !== mediaStream) return;
  // Ditolak → level lama dipertahankan, TANPA banner error. Zoom gagal bukan
  // bencana, cuma tidak terjadi. #cam-error disimpan untuk kegagalan yang
  // benar-benar menghalangi (izin, kamera tak terbaca).
  if (ok) { zoomAktif = x; markZoomAktif(); }
}

function renderZoomRow(levels) {
  const row = $('zoom-row');
  if (!row) return;
  if (!levels.length) { row.innerHTML = ''; row.hidden = true; return; }
  row.hidden = false;
  row.innerHTML = levels.map((l) =>
    `<button class="zoom-btn" type="button" data-x="${l.x}" data-nilai="${l.nilai}" aria-pressed="false">${l.x}×</button>`
  ).join('');
  row.querySelectorAll('.zoom-btn').forEach((b) => {
    b.addEventListener('click', () => onZoomTap(Number(b.dataset.x), Number(b.dataset.nilai)));
  });
  markZoomAktif();
}

// Baris diagnosis di Pengaturan: instrumen verifikasi lapangan. Tanpa angka mentah
// ini, laporan "4× buram" tak bisa dibedakan dari "HP-nya cuma sanggup 2×".
function renderCamInfo(track, caps) {
  const el = $('cam-info');
  if (!el) return;
  const s = track.getSettings ? track.getSettings() : {};
  const res = s.width && s.height ? `${s.width}×${s.height}` : '—';
  el.textContent = res + ' · ' + (caps ? `zoom ${caps.min}–${caps.max}` : 'tanpa zoom');
}

// Track kamera MATI dan LAHIR BARU tiap scan (freezeCamera saat jepret, stopCamera
// saat kembali ke dashboard), dan track baru selalu mulai dari 1×. Jadi zoom wajib
// dipasang ulang tiap kamera nyala. Fungsi ini dipanggil HANYA dari dalam
// startCamera() — satu-satunya jalur yang dilewati semua pintu masuk kamera
// (openCamera dan retryScan). Dengan begitu tak ada jalur yang bisa melewatkannya:
// bugnya ditiadakan, bukan dijaga.
// TIDAK PERNAH melempar: kegagalan zoom bukan kegagalan kamera.
async function setupZoom(video, mediaStream) {
  try {
    // Beberapa Android WebView mengembalikan getCapabilities() kosong sebelum track
    // benar-benar live. Timer 1,5s adalah jaring supaya tak menggantung bila
    // event-nya tak pernah datang.
    if (video.readyState < 1) {
      await new Promise((res) => {
        let selesai = false;
        const done = () => {
          if (selesai) return;
          selesai = true;
          video.removeEventListener('loadedmetadata', done);
          res();
        };
        video.addEventListener('loadedmetadata', done);
        setTimeout(done, 1500);
      });
    }
    const track = mediaStream.getVideoTracks()[0];
    if (stream !== mediaStream) return;
    if (!track) return;
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    zoomCaps = caps && caps.zoom ? caps.zoom : null;
    const levels = zoomLevels(zoomCaps);
    renderZoomRow(levels);
    renderCamInfo(track, zoomCaps);
    if (zoomAktif > 1) {
      const target = levels.find((l) => l.x === zoomAktif);
      // Gagal pasang ulang → turunkan ke 1× supaya tombol aktif tak berbohong
      // soal keadaan kamera yang sebenarnya.
      const terpasang = target && await applyZoom(track, target.nilai, zoomCaps && zoomCaps.step);
      if (stream !== mediaStream) return;
      if (!terpasang) {
        zoomAktif = 1;
      }
      markZoomAktif();
    }
  } catch (_) { /* zoom gagal != kamera gagal */ }
}

async function startCamera() {
  const errBox = $('cam-error');
  errBox.hidden = true;
  if (stream) return; // sudah aktif
  try {
    // Semua `ideal` — JANGAN `exact`: `exact` membuat getUserMedia menolak di HP
    // yang tak punya resolusi itu, dan kamera gagal total. Payload ke Gemini tetap
    // dibatasi MAX_CROP_W=800, jadi yang naik cuma ketajaman, bukan ukuran kirim.
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 3840 },
        height: { ideal: 2160 },
      },
      audio: false,
    });
    const video = $('video');
    video.srcObject = stream;
    await setupZoom(video, stream);
  } catch (e) {
    errBox.textContent =
      'Tidak bisa mengakses kamera: ' + e.message +
      '. Pastikan izin kamera diberikan dan halaman dibuka via HTTPS.';
    errBox.hidden = false;
  }
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
    $('video').srcObject = null;
  }
}

// Matikan kamera tapi biarkan frame terakhir tetap tampil (membeku).
// Dipakai saat jepret: kamera tak perlu jalan di latar selama loading scan.
function freezeCamera() {
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
    // sengaja TIDAK reset srcObject supaya frame terakhir membeku di layar
  }
}

// Batas crop & kompresi. Kirim HANYA isi kotak scan 5:3 (bukan seluruh
// frame), perkecil ke maksimal 800px lebar, kualitas JPEG 0,75 → payload
// jauh lebih ringan & token gambar Gemini berkurang → scan lebih cepat.
const MAX_CROP_W = 800;
const JPEG_QUALITY = 0.75;
const FRAME_AR = 5 / 3; // rasio kotak scan

// Hitung persegi sumber rasio `ar` yang berada di tengah area w×h.
function centerCrop(w, h, ar) {
  let sw = w, sh = w / ar;
  if (sh > h) { sh = h; sw = h * ar; }
  return { sx: (w - sw) / 2, sy: (h - sh) / 2, sw, sh };
}

// Petakan posisi kotak .cam-frame (koordinat layar) ke piksel sumber video,
// memperhitungkan object-fit: cover. Bila gagal → fallback crop tengah 5:3.
function computeFrameCrop(video) {
  const VW = video.videoWidth, VH = video.videoHeight;
  try {
    const wrap = video.parentElement;            // .cam-wrap
    const frameEl = wrap.querySelector('.cam-frame');
    const wr = wrap.getBoundingClientRect();
    const fr = frameEl.getBoundingClientRect();
    const scale = Math.max(wr.width / VW, wr.height / VH); // object-fit: cover
    const offX = (wr.width - VW * scale) / 2;     // video meluber & ter-center
    const offY = (wr.height - VH * scale) / 2;
    let sx = (fr.left - wr.left - offX) / scale;
    let sy = (fr.top - wr.top - offY) / scale;
    let sw = fr.width / scale;
    let sh = fr.height / scale;
    // Jaga tetap di dalam batas sumber.
    sx = Math.max(0, Math.min(sx, VW));
    sy = Math.max(0, Math.min(sy, VH));
    sw = Math.min(sw, VW - sx);
    sh = Math.min(sh, VH - sy);
    if (sw > 10 && sh > 10) return { sx, sy, sw, sh };
  } catch (_) {}
  return centerCrop(VW, VH, FRAME_AR);
}

// Gambar potongan `c` dari `source` ke canvas (≤800px lebar) → base64 JPEG.
function cropToBase64(source, c) {
  const canvas = $('canvas');
  const outW = Math.min(Math.round(c.sw), MAX_CROP_W);
  const outH = Math.round(outW * (c.sh / c.sw));
  canvas.width = outW;
  canvas.height = outH;
  canvas.getContext('2d').drawImage(source, c.sx, c.sy, c.sw, c.sh, 0, 0, outW, outH);
  return canvas.toDataURL('image/jpeg', JPEG_QUALITY).split(',')[1];
}

function capture() {
  const video = $('video');
  if (!video.videoWidth) {
    $('cam-error').textContent = 'Kamera belum siap. Coba sebentar lagi.';
    $('cam-error').hidden = false;
    return;
  }
  if (!passDemoGateOr('cam-error')) return; // demo: kuota habis → sheet; cooldown → pesan
  lastShot = cropToBase64(video, computeFrameCrop(video));
  freezeCamera(); // matikan kamera setelah jepret; nyalakan lagi hanya bila jepret ulang
  scanLabel(lastShot);
}

// Uji galeri: muat gambar pilihan user, crop tengah 5:3 (tak ada kotak
// kamera di sini), perkecil, lalu lewatkan ke pipeline scan yang sama.
function onGalleryPick(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = ''; // izinkan pilih file sama lagi nanti
  if (!file) return;
  if (!passDemoGateOr(null)) return; // galeri tak punya cam-error; quota→sheet, cooldown→senyap
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    lastShot = cropToBase64(img, centerCrop(img.width, img.height, FRAME_AR));
    URL.revokeObjectURL(url);
    scanLabel(lastShot);
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    showResult('', '', 'Gagal Muat');
    showResultError('Gambar tidak bisa dimuat.');
  };
  img.src = url;
}

/* ============================================================
   PANGGIL GEMINI
   ============================================================ */
// Timeout per percobaan (ms). Lonjakan cold-start free-tier (8–16s) dipotong
// di percobaan-1; retry biasanya mendarat di instance hangat (~2s). Percobaan-2
// diberi tenggang lebih panjang agar tak gampang menyerah saat memang lambat.
const SCAN_TIMEOUTS = [6000, 12000];

async function scanLabel(base64) {
  const demo = getActiveMode() === 'demo';
  if (demo) markDemoCooldown(); // spasi antar request konsisten (juga bila scan gagal)
  openSheet('overlay-loading');
  try {
    for (let i = 0; i < SCAN_TIMEOUTS.length; i++) {
      try {
        const result = await callForMode(base64, SCAN_TIMEOUTS[i]);
        closeSheet('overlay-loading');
        if (demo) renderQuota();
        // Titik normalisasi tunggal: BYOK dan Demo bertemu di sini.
        const norm = normalizePromo(result);
        showResult(norm.nama, norm.hargaDefault || '', undefined, norm);
        return;
      } catch (e) {
        // Error permanen (key/kuota/format) atau percobaan terakhir → menyerah.
        // Selain itu (timeout/jaringan/5xx) → coba sekali lagi.
        if (e.permanent || i === SCAN_TIMEOUTS.length - 1) throw e;
      }
    }
  } catch (e) {
    closeSheet('overlay-loading');
    // Tetap buka sheet hasil supaya user bisa isi manual,
    // dan tampilkan pesan error ASLI di dalam sheet (bukan di #cam-error
    // yang ketutup sheet) supaya penyebab gagal kelihatan.
    showResult('', '', 'Scan Gagal');
    showResultError(e.message);
  }
}

function showResultError(msg) {
  const el = $('res-error');
  el.textContent = msg + ' — isi manual atau ulangi.';
  el.hidden = false;
}

async function callDemoProxy(base64, timeoutMs) {
  if (!DEMO_PROXY_URL) {
    const err = new Error('Demo belum tersedia. Pakai API key sendiri atau input manual.');
    err.permanent = true;
    throw err;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(DEMO_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: getDemoDeviceId(),
        imageBase64: base64,
      }),
      signal: ctrl.signal,
    });
  } catch (e) {
    const err = new Error(e.name === 'AbortError' ? `timeout > ${timeoutMs / 1000}s` : e.message);
    err.permanent = false;
    throw err;
  } finally {
    clearTimeout(timer);
  }

  let payload = null;
  try { payload = await res.json(); } catch (_) {}

  if (!res.ok || !payload || payload.ok === false) {
    const err = new Error(payload?.message || 'Demo sedang tidak tersedia. Coba lagi nanti atau pakai API key sendiri.');
    err.status = res.status;
    err.code = payload?.code || 'DEMO_PROXY_ERROR';
    err.quota = payload?.quota || null;
    err.permanent = res.status >= 400 && res.status < 500 && res.status !== 429;
    throw err;
  }

  if (payload.quota) cacheDemoQuota(payload.quota);
  return payload.data;
}

/* Pilih jalur panggilan sesuai mode aktif. */
function callForMode(base64, timeoutMs) {
  return getActiveMode() === 'demo'
    ? callDemoProxy(base64, timeoutMs)
    : callGemini(getKey(), base64, timeoutMs);
}

async function callGemini(apiKey, base64, timeoutMs) {
  const url = `${API_BASE}/${MODEL}:generateContent`;
  const body = {
    contents: [
      {
        parts: [
          { text: PROMPT },
          { inline_data: { mime_type: 'image/jpeg', data: base64 } },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          nama: { type: 'STRING' },
          harga: { type: 'NUMBER' },
          promoTipe: { type: 'STRING', enum: ['none', 'diskon', 'member', 'bulk', 'gratis'] },
          promoQty: { type: 'NUMBER' },
          beliQty: { type: 'NUMBER' },
          gratisQty: { type: 'NUMBER' },
          hargaPromo: { type: 'NUMBER' },
          hargaNormal: { type: 'NUMBER' },
          syarat: { type: 'STRING' },
          labelWarna: { type: 'STRING', enum: ['kuning', 'merah', 'putih', 'lain'] },
          semuaHarga: { type: 'ARRAY', items: { type: 'NUMBER' } },
        },
        required: ['nama', 'harga'],
      },
    },
  };

  // Batalkan request bila melewati timeoutMs (lawan cold-start free-tier).
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  recordRequest(); // catat ke indikator kuota (RPM/RPD)
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Key dikirim via header (wajib untuk key format baru "AQ.",
        // dan tetap kompatibel dengan key lama "AIza"). Key di-pass sebagai
        // argumen supaya rotation demo bisa menukar key tiap percobaan.
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    // AbortError (timeout) atau error jaringan → sementara, boleh di-retry.
    const err = new Error(e.name === 'AbortError' ? `timeout > ${timeoutMs / 1000}s` : e.message);
    err.permanent = false;
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (j.error && j.error.message) msg = j.error.message;
    } catch (_) {}
    const err = new Error(msg);
    err.status = res.status; // dipakai rotation demo untuk deteksi 429
    // 4xx selain 429 = permanen (key/referrer/format) → jangan retry.
    // 429 (kuota) & 5xx (server) = sementara → boleh retry.
    err.permanent = res.status >= 400 && res.status < 500 && res.status !== 429;
    if (res.status === 429) markLimit(); // tampilkan "❌ Limit" di indikator
    throw err;
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return parseResult(text);
}

async function reconcileReceipt(base64Struk, daftarBelanja) {
  const body = {
    contents: [{
      parts: [
        { text: RECONCILE_PROMPT + '\n\nDAFTAR BELANJA:\n' + JSON.stringify(daftarBelanja) },
        { inline_data: { mime_type: 'image/jpeg', data: base64Struk } },
      ],
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            urut:    { type: 'INTEGER' },
            // enum WAJIB dipasang — pagar termurah yang ada (pelajaran promo v2).
            peran:   { type: 'STRING', enum: ['barang', 'potongan', 'total', 'penyesuaian', 'pembayaran', 'lain'] },
            nama:    { type: 'STRING' },
            qty:     { type: 'INTEGER' },
            harga:   { type: 'INTEGER' },
            total:   { type: 'INTEGER' },
            cocokKe: { type: 'INTEGER' },
          },
          required: ['urut', 'peran', 'total'],
        },
      },
    },
  };
  const ctrl = new AbortController();
  // 30s (naik dari 20s): output kini sepanjang STRUK, bukan sepanjang keranjang.
  const timer = setTimeout(() => ctrl.abort(), 30000);
  recordRequest();
  try {
    const res = await fetch(`${API_BASE}/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': getKey() },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error('Gemini ' + res.status);
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } finally {
    clearTimeout(timer);
  }
}

/* ==== PROMO RULES (start) ==== */
/* Sanitasi + seluruh aturan promo. Sengaja bebas DOM dan bebas dependensi
   (kecuali `rupiah`) supaya bisa diuji di node:vm tanpa memanggil Gemini.
   Prinsipnya: AI hanya melaporkan angka yang tertulis di label; semua
   aritmatika dan semua keputusan terjadi di sini. */

const PROMO_TIPE = ['none', 'diskon', 'member', 'bulk', 'gratis'];
const LABEL_WARNA = ['kuning', 'merah', 'putih', 'lain'];
// Klaim 'member' hanya sah kalau label benar-benar menuliskan syarat keanggotaan.
// Tambah nama program loyalitas baru di sini bila muncul di lapangan.
const SYARAT_MEMBER_RE = /member|kartu|alfagift|ponta|jakone|bonus\s*card|myvalue|klik\s*indomaret/i;
const HARGA_MIN = 100;        // di bawah ini biasanya gram/ml/kode barang, bukan harga
const HARGA_MAX = 10000000;
const MAX_KANDIDAT = 6;

const angka = (v) => {
  const n = parseInt(String(v == null ? '' : v).replace(/\D/g, ''), 10);
  return isNaN(n) ? 0 : n;
};

// Saring daftar harga mentah dari AI: buang yang mustahil jadi harga, buang
// kembar, urut naik, batasi jumlah chip yang nanti ditampilkan.
function bersihkanHarga(list) {
  const out = [];
  for (const v of Array.isArray(list) ? list : []) {
    const n = angka(v);
    if (n < HARGA_MIN || n > HARGA_MAX) continue;
    if (!out.includes(n)) out.push(n);
  }
  return out.sort((a, b) => a - b).slice(0, MAX_KANDIDAT);
}

function normalizePromo(raw) {
  const r = raw || {};
  const nama = String(r.nama == null ? '' : r.nama).trim();
  const harga = angka(r.harga);
  const hargaPromo = angka(r.hargaPromo);
  const hargaNormal = angka(r.hargaNormal);
  const promoQty = angka(r.promoQty);
  const beliQty = angka(r.beliQty);
  const gratisQty = angka(r.gratisQty);
  const syarat = String(r.syarat == null ? '' : r.syarat).trim().slice(0, 120);
  const labelWarna = LABEL_WARNA.includes(r.labelWarna) ? r.labelWarna : 'lain';
  const semuaHarga = bersihkanHarga(r.semuaHarga);

  // Aturan 1 — klaim bersyarat wajib bawa bukti. Harga coret TIDAK berarti
  // member; tanpa tulisan keanggotaan itu diskon biasa. Ini inti bug lapangan #1.
  let tipe = PROMO_TIPE.includes(r.promoTipe) ? r.promoTipe : 'none';
  if (tipe === 'member' && !SYARAT_MEMBER_RE.test(syarat)) tipe = 'diskon';

  // Aturan 2 — aritmatika beli-gratis dihitung di sini, bukan oleh AI:
  // bayar N satuan, terima N+M item. Inti bug lapangan #2.
  const totalItem = tipe === 'gratis' ? beliQty + gratisQty : 0;
  const hargaPaket = tipe === 'gratis' ? beliQty * hargaNormal : 0;

  // Aturan 3 — hasil kontradiktif jangan ditebak. Cocok pertama menentukan alasan.
  let alasan = '';
  if (tipe === 'none' && labelWarna === 'kuning' && semuaHarga.length >= 2) {
    // Dua sinyal bertemu: ada tanda promo (kuning) DAN ada beberapa harga.
    // Label non-kuning berharga ganda TIDAK masuk sini — banyak label biasa
    // memuat harga jual + harga per-100g yang dua-duanya sah.
    alasan = 'Label kuning & beberapa harga — pilih yang benar';
  } else if ((tipe === 'diskon' || tipe === 'member') && (hargaPromo <= 0 || hargaNormal <= 0)) {
    alasan = 'Harga promo/normal tak lengkap';
  } else if ((tipe === 'diskon' || tipe === 'member') && hargaPromo >= hargaNormal) {
    alasan = 'Harga promo tak lebih murah';
  } else if (tipe === 'bulk' && (promoQty < 2 || hargaPromo <= 0)) {
    alasan = 'Data paket tak lengkap';
  } else if (tipe === 'bulk' && hargaNormal > 0 && hargaPromo >= promoQty * hargaNormal) {
    alasan = 'Harga paket tak lebih murah';
  } else if (tipe === 'gratis' && (beliQty < 1 || gratisQty < 1 || hargaNormal <= 0)) {
    alasan = 'Data beli-gratis tak lengkap';
  }

  const out = {
    nama, harga, tipe, hargaPromo, hargaNormal, promoQty, beliQty, gratisQty,
    hargaPaket, totalItem, syarat, labelWarna, semuaHarga,
    hargaDefault: 0, promoDefault: null,
    kandidat: { aktif: !!alasan, alasan },
    peringatan: '',
  };

  // Aturan 4 — promo yang meragukan tak pernah diteruskan ke keranjang.
  if (out.kandidat.aktif) {
    out.tipe = 'none';
    return out;
  }

  // Aturan 5 — harga yang boleh diisi otomatis. Promo bersyarat (member) dan
  // promo berubah-jumlah (bulk, gratis) sengaja dibiarkan kosong: user memilih.
  if (tipe === 'none') out.hargaDefault = harga;
  if (tipe === 'diskon') {
    out.hargaDefault = hargaPromo;
    out.promoDefault = { tipe: 'diskon', label: 'Diskon', hargaNormal };
  }

  // Aturan 6 — warna hanya menaikkan kewaspadaan, tak pernah mengubah angka.
  if (labelWarna === 'kuning' && out.tipe === 'none') {
    out.peringatan = 'Label kuning — biasanya promo. Cek syaratnya.';
  }
  return out;
}

function promoChips(norm) {
  if (!norm || norm.kandidat.aktif) return [];

  if (norm.tipe === 'member') {
    return [
      {
        label: `Member ${rupiah(norm.hargaPromo)}`,
        harga: norm.hargaPromo,
        lockQty: false,
        promo: { tipe: 'member', label: 'Member', hargaNormal: norm.hargaNormal || null },
      },
      {
        label: `Non-member ${rupiah(norm.hargaNormal)}`,
        harga: norm.hargaNormal,
        lockQty: false,
        promo: null,
      },
    ];
  }

  // Untuk bulk & gratis, norm.hargaNormal bermakna HARGA SATUAN (bukan harga coret).
  // Coretan di baris keranjang harus memakai harga tanpa promo untuk jumlah item
  // yang sama, yaitu qtyPaket x satuan — kalau tidak, coretan malah terbaca
  // seperti harga naik.
  if (norm.tipe === 'bulk') {
    const label = `Paket ${norm.promoQty} item`;
    const chips = [{
      label: `${label} ${rupiah(norm.hargaPromo)}`,
      harga: norm.hargaPromo,
      lockQty: true,
      promo: {
        tipe: 'bulk',
        qtyPaket: norm.promoQty,
        label,
        hargaNormal: norm.hargaNormal > 0 ? norm.promoQty * norm.hargaNormal : null,
      },
    }];
    if (norm.hargaNormal > 0) {
      chips.push({
        label: `Satuan ${rupiah(norm.hargaNormal)}`,
        harga: norm.hargaNormal,
        lockQty: false,
        promo: null,
      });
    }
    return chips;
  }

  if (norm.tipe === 'gratis') {
    const label = `Beli ${norm.beliQty} gratis ${norm.gratisQty}`;
    return [
      {
        label: `${label} · ${rupiah(norm.hargaPaket)} (${norm.totalItem} item)`,
        harga: norm.hargaPaket,
        lockQty: true,
        promo: {
          tipe: 'gratis',
          qtyPaket: norm.totalItem,
          label: `${label} · ${norm.totalItem} item`,
          hargaNormal: norm.totalItem * norm.hargaNormal,
        },
      },
      {
        label: `Satuan ${rupiah(norm.hargaNormal)}`,
        harga: norm.hargaNormal,
        lockQty: false,
        promo: null,
      },
    ];
  }

  return []; // none & diskon: harga sudah terisi otomatis, tak perlu chip
}
/* ==== PROMO RULES (end) ==== */

/* ==== RECONCILE RULES (start) ==== */
/* Seluruh aritmatika & putusan rekonsiliasi struk. Sengaja bebas DOM dan bebas
   dependensi (kecuali itemQty/itemSub) supaya bisa diuji di node:vm tanpa foto
   struk dan tanpa memanggil Gemini. Prinsipnya sama dengan PROMO RULES: AI hanya
   MENYALIN apa yang tertulis di struk; setiap keputusan terjadi di sini. */

// Jumlah barang FISIK, bukan jumlah baris keranjang. Untuk promo paket, satu baris
// keranjang = satu paket berisi qtyPaket barang (qty-nya dikunci 1 di picker), jadi
// struk yang menulis "qty 2" itu BENAR dan bukan selisih jumlah.
function unitFisik(it) {
  const paket = it.promo && it.promo.qtyPaket > 0 ? it.promo.qtyPaket : 1;
  return itemQty(it) * paket;
}

// Kelompokkan keranjang jadi grup produk (kunci = nama persis). Wajib, bukan
// pilihan: struk menggabungkan SKU sama jadi satu baris, dan baris void (qty
// negatif) hanya bisa dinetralkan lewat penjumlahan.
// `i` adalah SATU-SATUNYA kunci penautan yang dipakai selanjutnya — penautan lewat
// nama ditinggalkan karena nama kembar saling menimpa.
function grupKeranjang(cart) {
  const map = new Map();
  (Array.isArray(cart) ? cart : []).forEach((it, idx) => {
    const g = map.get(it.nama) || {
      i: map.size, nama: it.nama, unit: 0, total: 0, rowIdx: [], adaPromo: false,
    };
    g.unit += unitFisik(it);
    g.total += itemSub(it);   // harga paket × qty → benar untuk semua jenis promo
    g.rowIdx.push(idx);
    if (it.promo) g.adaPromo = true;
    map.set(it.nama, g);
  });
  return [...map.values()];
}

const RC_PERAN = ['barang', 'potongan', 'total', 'penyesuaian', 'pembayaran', 'lain'];

// Pemeriksa silang kosakata. TURUN PANGKAT dari mesin utama jadi jaring pengaman:
// denylist selalu jebol di toko yang belum pernah didatangi, jadi yang diandalkan
// adalah `peran` dari AI + aturan posisi. Ini cuma boleh MENURUNKAN 'barang'.
const RC_RE_SESUAI = /^\s*(pembulatan|rounding)\b/i;
const RC_RE_TOTAL  = /^\s*(sub\s*-?\s*total|total|jumlah\s*(bayar|belanja)?)\b/i;
const RC_RE_POTONG = /^\s*(hemat|disc|diskon|potongan|promo|voucher|subsidi)\b/i;
const RC_RE_BAYAR  = /(tunai|cash|kembali|kembalian|debit|kredit|qris|e-?money|flazz|brizzi|gopay|ovo|dana|shopee\s*pay|npwp|kasir|no\.?\s*trx)/i;

// Angka struk: buang pemisah ribuan, pertahankan tanda minus di depan (baris void).
function rcAngka(v) {
  const s = String(v == null ? '' : v);
  const negatif = /^\s*[-(]/.test(s);
  const n = parseInt(s.replace(/\D/g, ''), 10);
  if (isNaN(n)) return 0;
  return negatif ? -n : n;
}

function rcSanitasiBaris(raw, i) {
  const r = raw || {};
  const peran = RC_PERAN.includes(r.peran) ? r.peran : 'lain';
  const qty = rcAngka(r.qty);
  const harga = rcAngka(r.harga);
  let total = rcAngka(r.total);
  // Aritmatika di JS, bukan diminta ke AI.
  if (total === 0 && harga !== 0 && qty !== 0) total = harga * qty;
  // `cocokKe` yang HILANG tak boleh jadi 0 — itu indeks grup pertama.
  let cocokKe = r.cocokKe == null ? -1 : rcAngka(r.cocokKe);
  if (peran !== 'barang') cocokKe = -1;
  return {
    urut: rcAngka(r.urut) || (i + 1),
    peran,
    nama: String(r.nama == null ? '' : r.nama).trim().slice(0, 60),
    qty, harga, total, cocokKe,
  };
}

function rcPeriksaPeran(baris) {
  if (baris.peran !== 'barang') return baris;
  const n = baris.nama;
  let peran = 'barang';
  if (RC_RE_SESUAI.test(n)) peran = 'penyesuaian';
  else if (RC_RE_TOTAL.test(n)) peran = 'total';
  else if (RC_RE_POTONG.test(n)) peran = 'potongan';
  else if (RC_RE_BAYAR.test(n)) peran = 'pembayaran';
  if (peran === 'barang') return baris;
  return Object.assign({}, baris, { peran, cocokKe: -1 });
}

// Aturan POSISI — lebih kuat dari kosakata. Semua struk menaruh pembayaran SETELAH
// total, jadi apa pun di bawah baris total terakhir tak mungkin barang. Ini yang
// menutup baris pembayaran di toko yang formatnya belum pernah dilihat, tanpa perlu
// tahu kata yang dipakainya.
function rcBatasPosisi(baris) {
  let urutTotal = -Infinity;
  for (const b of baris) if (b.peran === 'total' && b.urut > urutTotal) urutTotal = b.urut;
  if (urutTotal === -Infinity) return baris;
  return baris.map((b) => (b.urut > urutTotal && b.peran === 'barang'
    ? Object.assign({}, b, { peran: 'lain', cocokKe: -1 })
    : b));
}
// Jangkar = satu-satunya angka yang pasti ada dan berarti sama di SEMUA struk di
// semua toko. Selain memverifikasi bacaan, dia juga detektor output AI terpotong.
// Tak pernah mengubah status item — cuma menjawab "apakah bacaan struknya utuh".
function rcJangkar(baris) {
  let bruto = 0, potongan = 0, penyesuaian = 0;
  let jangkar = null, urutJangkar = -Infinity;
  for (const b of baris) {
    if (b.peran === 'barang') bruto += b.total;
    else if (b.peran === 'potongan') potongan += b.total;
    else if (b.peran === 'penyesuaian') penyesuaian += b.total;
    else if (b.peran === 'total' && b.urut > urutJangkar) {
      urutJangkar = b.urut;
      jangkar = b.total;
    }
  }
  const hitungJS = bruto + potongan + penyesuaian;
  const ada = jangkar != null;
  return {
    bruto, potongan, penyesuaian, hitungJS,
    jangkar: ada ? jangkar : hitungJS,
    cocok: ada ? jangkar === hitungJS : false,
    takTerjelaskan: ada ? jangkar - hitungJS : 0,
  };
}

// Baris potongan milik baris 'barang' TERDEKAT SEBELUMNYA (menurut urut).
// Objek biasa (bukan Map) supaya bisa dites lewat round-trip JSON.
// Begitu blok total dimulai, "barang terakhir" DIRESET.
function rcTautkanPotongan(baris) {
  const urutNaik = baris.slice().sort((a, b) => a.urut - b.urut);
  const per = {};
  let barangTerakhir = null;
  for (const b of urutNaik) {
    if (b.peran === 'barang') barangTerakhir = b;
    else if (b.peran === 'total') barangTerakhir = null;
    else if (b.peran === 'potongan' && barangTerakhir) {
      per[barangTerakhir.urut] = (per[barangTerakhir.urut] || 0) + b.total;
    }
  }
  return per;
}

function rcGrupStruk(baris, potonganPer) {
  const grup = {};
  const asing = [];
  for (const b of baris) {
    if (b.peran !== 'barang') continue;
    const net = b.total + (potonganPer[b.urut] || 0);
    if (b.cocokKe < 0) {
      asing.push({ nama: b.nama, qty: Math.abs(b.qty) || 1, net });
      continue;
    }
    const g = grup[b.cocokKe] || { unit: 0, net: 0, terbaca: true };
    g.unit += b.qty;
    g.net += net;
    if (b.total === 0 && b.harga === 0) g.terbaca = false;
    grup[b.cocokKe] = g;
  }
  return { grup, asing };
}
// Satu-satunya pintu masuk perhitungan. AI sudah selesai tugasnya sebelum ini:
// yang masuk cuma transkripsi + tautan, semua putusan terjadi di sini.
function reconcileHitung(grupCart, barisMentah) {
  const cart = Array.isArray(grupCart) ? grupCart : [];
  const bersih = rcBatasPosisi(
    (Array.isArray(barisMentah) ? barisMentah : [])
      .map(rcSanitasiBaris)
      .map(rcPeriksaPeran)
  ).map((b) => (b.cocokKe >= cart.length
    ? Object.assign({}, b, { cocokKe: -1 })
    : b));
  const potonganPer = rcTautkanPotongan(bersih);
  const { grup, asing } = rcGrupStruk(bersih, potonganPer);
  const jk = rcJangkar(bersih);

  const rows = cart.map((g) => {
    const s = grup[g.i];
    // URUTAN MENGIKAT — cocok pertama menentukan status. qty diperiksa sebelum
    // harga: kalau jumlahnya beda, selisih uangnya adalah AKIBAT, bukan soal harga.
    let status;
    if (!s) status = 'tak_ketemu';
    else if (!s.terbaca) status = 'tak_pasti';
    else if (s.unit !== g.unit) status = 'qty_beda';
    else if (s.net > g.total) status = 'lebih_mahal';
    else if (s.net < g.total) status = 'lebih_murah';
    else status = 'sama';
    return {
      i: g.i,
      nama: g.nama,
      unitKeranjang: g.unit,
      unitStruk: s ? s.unit : 0,
      totalKeranjang: g.total,
      totalStruk: s ? s.net : 0,
      selisih: s ? s.net - g.total : 0,
      status,
    };
  });

  const totalKeranjang = cart.reduce((a, g) => a + g.total, 0);
  return {
    rows,
    asing,
    totalKeranjang,
    totalStruk: jk.jangkar,
    selisih: jk.jangkar - totalKeranjang,
    hemat: Math.abs(jk.potongan),
    jangkar: { cocok: jk.cocok, takTerjelaskan: jk.takTerjelaskan },
  };
}
// Ubah satu baris struk asing jadi baris keranjang. Deterministik: kalau net tak
// terbagi bulat, jadikan SATU baris seharga net supaya total keranjang tetap persis
// benar — lebih baik satu baris "aneh" daripada pembulatan yang menyelip ke total.
function barisDariStruk(net, qty) {
  const q = Math.abs(rcAngka(qty)) || 1;
  const satuan = Math.round(net / q);
  return satuan * q === net ? { harga: satuan, qty: q } : { harga: net, qty: 1 };
}
/* ==== RECONCILE RULES (end) ==== */

// Ekstraksi JSON dari balasan Gemini. Sanitasi & aturan TIDAK di sini —
// itu tugas normalizePromo, yang dipanggil di scanLabel supaya mode BYOK dan
// mode Demo (yang tak melewati fungsi ini) sama-sama kena aturannya.
function parseResult(text) {
  let clean = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start !== -1 && end !== -1) clean = clean.slice(start, end + 1);

  let obj;
  try {
    obj = JSON.parse(clean);
  } catch (_) {
    throw new Error('Format hasil tidak terbaca');
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('Format hasil tidak terbaca');
  }
  return obj;
}

/* ============================================================
   HASIL SCAN
   ============================================================ */
function showResult(nama, harga, title, promoInfo) {
  $('result-title').textContent = title || 'Hasil Scan';
  $('res-error').hidden = true; // bersihkan error lama
  $('res-nama').value = nama;
  $('res-harga').value = harga;
  $('res-qty').value = 1; // tiap hasil baru mulai dari 1
  renderPromoPicker(promoInfo);
  showPriceHint(nama);
  openSheet('sheet-result');
}

// Render zona promo di sheet hasil dari hasil normalizePromo.
// Fungsi ini sengaja hanya menggambar — semua keputusan sudah diambil di
// normalizePromo/promoChips supaya bisa diuji tanpa DOM.
function renderPromoPicker(norm) {
  pendingPromo = null;
  const box = $('res-promo');
  const note = $('promo-note');
  const syaratEl = $('promo-syarat');
  const warnEl = $('promo-warn');
  const altBtn = $('btn-promo-alt');

  // Bersihkan semua zona dulu; tiap cabang di bawah menyalakan yang perlu saja.
  box.hidden = true;
  note.hidden = true;
  syaratEl.hidden = true;
  warnEl.hidden = true;
  altBtn.hidden = true;
  $('promo-alt').hidden = true;
  $('promo-b').hidden = false;
  $('res-qty').disabled = false;

  if (!norm) { syncAddEnabled(); return; }

  // Kutipan syarat apa adanya: sekali lihat, user tahu AI salah baca atau tidak.
  if (norm.syarat) {
    syaratEl.textContent = `dibaca: "${norm.syarat}"`;
    syaratEl.hidden = false;
  }

  // Hasil kontradiktif → langsung tawarkan kandidat harga, jangan menebak.
  if (norm.kandidat.aktif) {
    warnEl.textContent = norm.kandidat.alasan;
    warnEl.hidden = false;
    openKandidat(norm);
    syncAddEnabled();
    return;
  }

  if (norm.peringatan) {
    warnEl.textContent = norm.peringatan;
    warnEl.hidden = false;
  }

  // Jalan keluar manual: selalu ada selama AI membaca lebih dari satu harga.
  if (norm.semuaHarga.length >= 2) {
    altBtn.hidden = false;
    altBtn.onclick = () => openKandidat(norm);
  }

  // Diskon polos tak bersyarat → harga sudah diisi showResult, tak perlu tanya.
  if (norm.promoDefault) {
    pendingPromo = norm.promoDefault;
    if (norm.hargaNormal > 0) {
      const hemat = norm.hargaNormal - norm.hargaPromo;
      note.innerHTML = `<span class="ci-strike">${rupiah(norm.hargaNormal)}</span> `
        + `<span>${rupiah(norm.hargaPromo)} · hemat ${rupiah(hemat)}</span>`;
      note.hidden = false;
    }
  }

  // Promo bersyarat / berubah-jumlah → user memilih sadar, harga dikosongkan.
  const chips = promoChips(norm);
  if (chips.length) {
    box.hidden = false;
    $('res-harga').value = '';
    bindPromoChip($('promo-a'), chips[0]);
    if (chips[1]) bindPromoChip($('promo-b'), chips[1]);
    else $('promo-b').hidden = true;
  }
  syncAddEnabled();
}

function bindPromoChip(btn, chip) {
  btn.textContent = chip.label;
  btn.onclick = () => pickPromo(chip.harga, chip.lockQty, chip.promo);
}

// Zona kandidat: tampilkan semua harga yang terbaca AI, user tap yang benar.
// Memilih di sini selalu membuang jejak promo — kita tak tahu harga itu milik
// skema promo yang mana.
function openKandidat(norm) {
  const wrap = $('promo-alt-chips');
  const list = norm.semuaHarga.length ? norm.semuaHarga : (norm.harga > 0 ? [norm.harga] : []);
  wrap.innerHTML = '';
  if (!list.length) {
    wrap.textContent = 'Harga tak terbaca — isi manual.';
  } else {
    for (const h of list) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = rupiah(h);
      b.onclick = () => pickPromo(h, false, null);
      wrap.appendChild(b);
    }
  }
  $('res-promo').hidden = true;
  $('promo-note').hidden = true;
  $('btn-promo-alt').hidden = true;
  $('res-harga').value = '';
  pendingPromo = null;
  $('res-qty').disabled = false;
  $('promo-alt').hidden = false;
  syncAddEnabled();
}

// Chip dipilih: isi harga, kunci qty bila paket, simpan jejak promo.
function pickPromo(harga, lockQty, promo) {
  $('res-harga').value = harga || '';
  const qtyInp = $('res-qty');
  const note = $('promo-note');
  if (lockQty) {
    qtyInp.value = 1;
    qtyInp.disabled = true;
    note.textContent = promo && promo.qtyPaket > 0 ? `1 paket = ${promo.qtyPaket} item` : '1 paket';
    note.hidden = false;
  } else {
    qtyInp.disabled = false;
    note.hidden = true;
  }
  pendingPromo = promo;
  syncAddEnabled();
}

// Tombol Tambah mengikuti isi input harga, bukan "sudah tap chip atau belum".
// Pemaksaan pilih sadar tetap jalan (input dikosongkan untuk promo bersyarat),
// tapi user tak pernah terkunci saat AI gagal total — harga masih bisa diketik.
function syncAddEnabled() {
  const v = parseInt($('res-harga').value, 10);
  setAddEnabled(!isNaN(v) && v > 0);
}

// Aktif/nonaktifkan tombol Tambah.
function setAddEnabled(on) {
  const btn = $('btn-add');
  if (btn) btn.disabled = !on;
}

// Cari pembelian terakhir barang bernama sama di riwayat (match nama
// ternormalisasi: trim + huruf kecil). Riwayat tersimpan terbaru-dulu,
// jadi kecocokan pertama = paling baru.
function lastPurchase(nama) {
  const key = (nama || '').trim().toLowerCase();
  if (!key) return null;
  for (const sesi of loadHistory()) {
    for (const it of sesi.items) {
      if ((it.nama || '').trim().toLowerCase() === key) return { harga: it.harga, ts: sesi.ts };
    }
  }
  return null;
}

// Tampilkan petunjuk "terakhir dibeli Rp X · tgl" di sheet hasil scan bila
// barang ini pernah dibeli sebelumnya — bantu pantau harga naik/turun.
function showPriceHint(nama) {
  const el = $('res-hint');
  if (!el) return;
  const prev = lastPurchase(nama);
  if (!prev) { el.hidden = true; return; }
  el.innerHTML = svgIcon('tag', 15) + `<span>Terakhir dibeli ${rupiah(prev.harga)} · ${fmtDateShort(prev.ts)}</span>`;
  el.hidden = false;
}

// Naik/turunkan nilai input jumlah, jaga minimal 1.
function bumpQty(inputId, delta) {
  const el = $(inputId);
  const next = Math.max(1, (parseInt(el.value, 10) || 1) + delta);
  el.value = next;
}
// Baca input jumlah jadi integer ≥ 1.
function readQty(inputId) {
  return Math.max(1, parseInt($(inputId).value, 10) || 1);
}

// Tombol "Input Manual" di dashboard → sheet kosong, tanpa kamera.
function inputManual() {
  showResult('', '', 'Input Manual');
}

function addToCart() {
  const nama = $('res-nama').value.trim();
  const harga = parseInt($('res-harga').value, 10);
  const qty = readQty('res-qty');
  if (!nama) { $('res-nama').focus(); return; }
  if (isNaN(harga)) { $('res-harga').focus(); return; }

  // Peringatan anggaran: bila item ini bikin total nembus batas, minta
  // konfirmasi sekali (hanya pada item yang menyebabkan kelewatan).
  if (!confirmIfOverBudget(harga * qty)) return;

  const item = { nama, harga, qty, photoId: null };
  if (pendingPromo) item.promo = pendingPromo;

  // Simpan foto rak terpisah dari keranjang; kegagalan IndexedDB tidak boleh
  // menggagalkan penambahan item.
  if (lastShot && window.PhotoDB && window.Retention) {
    const sid = ensureSessionId();
    const now = Date.now();
    const photoId = 'p_' + now + '_' + Math.random().toString(36).slice(2, 7);
    item.photoId = photoId;
    window.PhotoDB.putPhoto({
      id: photoId,
      sessionId: sid,
      nama,
      hargaRak: harga,
      base64: lastShot,
      createdAt: now,
      status: 'pending',
      expiresAt: window.Retention.nextExpiry('pending', now),
      hargaKasir: null,
      matchedAt: null,
    });
  }
  cart.push(item);
  pendingPromo = null;
  sessionSaved = false; // keranjang berubah → boleh dicatat ulang
  persistCart();
  closeSheet('sheet-result');
  $('cam-error').hidden = true;
  enterDashboard(); // selesai tambah → kembali ke dashboard
}

function retryScan() {
  closeSheet('sheet-result');
  $('cam-error').hidden = true;
  // Kalau masih di layar kamera, hidupkan lagi supaya bisa jepret ulang.
  // (Kalau hasil ini dari Input Manual di dashboard, kamera tak disentuh.)
  if (!$('screen-camera').hidden) startCamera();
}

/* ============================================================
   KERANJANG
   ============================================================ */
// Jumlah unit satu item (kompat data lama tanpa qty → dianggap 1).
function itemQty(it) { return Math.max(1, it.qty || 1); }
// Subtotal satu item = harga × jumlah.
function itemSub(it) { return it.harga * itemQty(it); }
function cartTotal() { return cart.reduce((s, it) => s + itemSub(it), 0); }
// Jumlah unit total seluruh keranjang (bukan jumlah baris).
function cartUnits() { return cart.reduce((s, it) => s + itemQty(it), 0); }

// HTML badge promo (chip kecil ikon tag + label). '' bila item tanpa promo.
function promoBadge(it) {
  if (it.dariStruk) return `<span class="ci-badge">${svgIcon('tag', 12)}Dari struk</span>`;
  return it.promo ? `<span class="ci-badge">${svgIcon('tag', 12)}${it.promo.label}</span>` : '';
}
// HTML harga coret harga normal bila ada. '' bila tak ada.
function promoStrike(it) {
  return it.promo && it.promo.hargaNormal
    ? `<span class="ci-strike">${rupiah(it.promo.hargaNormal)}</span> `
    : '';
}

function renderCart() {
  const cc = $('cart-count');
  if (cc) cc.textContent = cart.length;
  $('cart-total').textContent = rupiah(cartTotal());
  renderBudget();

  const list = $('cart-list');
  const empty = $('cart-empty');
  list.innerHTML = '';

  if (cart.length === 0) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  cart.forEach((it, i) => {
    const q = itemQty(it);
    const li = document.createElement('li');
    li.className = 'cart-item';
    li.innerHTML = `
      <button class="ci-tap" type="button">
        <span class="ci-text">
          <span class="ci-name"></span>
          ${promoBadge(it)}
          <span class="ci-qty"></span>
        </span>
        <span class="ci-price">${promoStrike(it)}${rupiah(itemSub(it))}</span>
      </button>
      <button class="ci-del" aria-label="Hapus">${svgIcon('trash', 18)}</button>`;
    li.querySelector('.ci-name').textContent = it.nama;
    // Tampilkan rincian "qty × harga" hanya bila lebih dari 1 unit.
    li.querySelector('.ci-qty').textContent = q > 1 ? `${q} × ${rupiah(it.harga)}` : '';
    li.querySelector('.ci-tap').addEventListener('click', () => openEdit(i));
    li.querySelector('.ci-del').addEventListener('click', () => removeItem(i));
    list.appendChild(li);
  });
}

function removeItem(i) {
  cart.splice(i, 1);
  sessionSaved = false; // keranjang berubah → boleh dicatat ulang
  persistCart();
  renderCart();
}

/* ---------- Edit item keranjang ---------- */
function openEdit(i) {
  editIndex = i;
  $('edit-nama').value = cart[i].nama;
  $('edit-harga').value = cart[i].harga;
  $('edit-qty').value = itemQty(cart[i]);
  openSheet('sheet-edit');
}

function saveEdit() {
  if (editIndex < 0) return;
  const nama = $('edit-nama').value.trim();
  const harga = parseInt($('edit-harga').value, 10);
  const qty = readQty('edit-qty');
  if (!nama) { $('edit-nama').focus(); return; }
  if (isNaN(harga)) { $('edit-harga').focus(); return; }

  // Cek anggaran terhadap selisih subtotal (nilai baru vs lama item ini).
  const delta = harga * qty - itemSub(cart[editIndex]);
  if (delta > 0 && !confirmIfOverBudget(delta)) return;

  const previous = cart[editIndex];
  cart[editIndex] = { nama, harga, qty, photoId: previous.photoId || null };
  if (previous.promo) cart[editIndex].promo = previous.promo;
  editIndex = -1;
  sessionSaved = false;
  persistCart();
  closeSheet('sheet-edit');
  renderCart(); // total ikut diperbarui
}

/* ============================================================
   ANGGARAN BELANJA (per sesi)
   Batas belanja sekali pakai. Tak disimpan ke localStorage — hidup
   selama sesi keranjang, di-reset di newShopping(). Bar di dashboard
   menunjukkan pemakaian terhadap batas; ambang 80% = "mendekati".
   ============================================================ */
const BUDGET_NEAR = 0.8; // ≥80% anggaran terpakai → status "mendekati" (oranye)

function openBudget() {
  $('budget-input').value = budget > 0 ? budget : '';
  openSheet('sheet-budget');
}

function saveBudget() {
  const val = parseInt($('budget-input').value, 10);
  budget = isNaN(val) || val <= 0 ? 0 : val; // ≤0 / kosong = anggap tak diatur
  persistCart(); // anggaran ikut tersimpan bersama keranjang sesi
  closeSheet('sheet-budget');
  renderBudget();
}

function clearBudget() {
  budget = 0;
  persistCart();
  closeSheet('sheet-budget');
  renderBudget();
}

// Render baris Total + anggaran di dashboard sesuai total keranjang saat ini.
function renderBudget() {
  const bar = $('budget-bar');
  const remain = $('budget-remain');
  const track = $('budget-track');
  const fill = $('budget-fill');
  if (!bar) return;

  // Belum diatur: baris Total bersih, bar disembunyikan, beri petunjuk halus.
  if (budget <= 0) {
    bar.className = 'total-budget';
    remain.textContent = 'atur anggaran';
    remain.style.color = 'var(--text-dim)';
    track.hidden = true;
    fill.style.width = '0';
    return;
  }

  const total = cartTotal();
  const ratio = total / budget;
  const sisa = budget - total;
  track.hidden = false;
  fill.style.width = Math.min(100, ratio * 100) + '%';
  remain.style.color = ''; // warna diatur lewat kelas tingkat di CSS

  let level;
  if (sisa < 0) {
    level = 'budget-over';
    remain.textContent = `lewat ${rupiah(-sisa)}`;
  } else if (ratio >= BUDGET_NEAR) {
    level = 'budget-near';
    remain.textContent = `sisa ${rupiah(sisa)}`;
  } else {
    level = 'budget-ok';
    remain.textContent = `sisa ${rupiah(sisa)}`;
  }
  bar.className = 'total-budget ' + level;
}

// Dipanggil sebelum menambah/menaikkan nilai keranjang sebesar `tambahan`.
// Bila anggaran diatur dan penambahan ini MEMBUAT total nembus batas
// (padahal sebelumnya belum), minta konfirmasi sekali. Return true = lanjut.
function confirmIfOverBudget(tambahan) {
  if (budget <= 0) return true;
  const sebelum = cartTotal();
  const sesudah = sebelum + tambahan;
  if (sesudah <= budget) return true;       // masih dalam anggaran → lanjut
  if (sebelum > budget) return true;         // sudah lewat sejak tadi → jangan nag lagi
  return confirm(
    `Item ini bikin total ${rupiah(sesudah)}, lewat anggaran ${rupiah(budget)}.\n` +
    `Tetap tambahkan?`
  );
}

/* ============================================================
   RINGKASAN
   ============================================================ */
// Baris item read-only untuk ringkasan & detail riwayat: nama (+ "q × harga"
// bila lebih dari 1) di kiri, subtotal di kanan.
function lineItem(it) {
  const q = itemQty(it);
  const li = document.createElement('li');
  li.className = 'cart-item';
  li.innerHTML = `
    <span class="ci-text">
      <span class="ci-name"></span>
      ${promoBadge(it)}
      <span class="ci-qty"></span>
    </span>
    <span class="ci-price">${promoStrike(it)}${rupiah(itemSub(it))}</span>`;
  li.querySelector('.ci-name').textContent = it.nama;
  li.querySelector('.ci-qty').textContent = q > 1 ? `${q} × ${rupiah(it.harga)}` : '';
  return li;
}

function finishShopping() {
  if (cart.length === 0) return;

  // Simpan sesi ini ke riwayat sekali per komposisi keranjang.
  if (!sessionSaved) {
    recordSession();
    sessionSaved = true;
    persistCart(); // tandai tersimpan agar reload tak mencatat ganda
  }

  const list = $('summary-list');
  list.innerHTML = '';
  cart.forEach((it) => {
    list.appendChild(lineItem(it));
  });

  $('sum-count').textContent = cartUnits();
  $('sum-total').textContent = rupiah(cartTotal());
  maybeFinishWithNote();
}

function newShopping() {
  cart = [];
  lastShot = null;
  cartSessionId = null;
  sessionSaved = false;
  budget = 0; // anggaran per sesi → reset saat mulai belanja baru
  localStorage.removeItem(CART_STORAGE); // belanja kelar → buang simpanan keranjang
  localStorage.removeItem(SESSION_STORAGE);
  closeSheet('sheet-summary');
  renderCart();
}

function onReconcileClick() {
  if (localStorage.getItem(ACTIVE_MODE_KEY) === 'demo') {
    alert('Fitur cocokkan struk butuh API key sendiri. Ganti ke mode "Pakai API Key Sendiri" di Pengaturan.');
    return;
  }
  if (cart.length === 0) return;
  $('receipt-file').value = '';
  $('receipt-file').click();
}

async function onReceiptPicked(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    const base64 = await fileToBase64(file);
    lastGrup = grupKeranjang(cart);
    const daftar = lastGrup.map((g) => ({ i: g.i, nama: g.nama, unit: g.unit, total: g.total }));
    openReconcileScreen();
    lastBaris = await reconcileReceipt(base64, daftar);
    const hasil = reconcileHitung(lastGrup, lastBaris);
    await applyReconcileResult(hasil);
    renderReconcile(hasil);
  } catch (_) {
    showReconcileError('Gagal membaca struk. Coba lagi.');
  }
}

async function applyReconcileResult(hasil) {
  if (!window.PhotoDB || !cartSessionId || !lastGrup) return;
  const now = Date.now();
  for (const row of hasil.rows) {
    const grup = lastGrup.find((g) => g.i === row.i);
    if (!grup) continue;
    const status = window.Retention.mapMatchStatus(row.status);
    for (const idx of grup.rowIdx) {
      const it = cart[idx];
      if (!it || !it.photoId) continue;
      const photo = await window.PhotoDB.getPhoto(it.photoId);
      if (!photo) continue;
      photo.status = status;
      photo.hargaKasir = row.totalStruk || null;
      photo.matchedAt = now;
      if (status !== 'pending') photo.expiresAt = window.Retention.nextExpiry(status, now);
      await window.PhotoDB.putPhoto(photo);
    }
  }
}

function openReconcileScreen() {
  closeSheet('sheet-summary');
  showScreen('screen-reconcile');
  $('reconcile-error').hidden = true;
  $('reconcile-body').innerHTML = '<p class="muted">Membaca struk...</p>';
  $('reconcile-summary').innerHTML = '';
}

function showReconcileError(message) {
  const error = $('reconcile-error');
  error.textContent = message;
  error.hidden = false;
  $('reconcile-body').innerHTML = '';
}

const RC_JUDUL = {
  lebih_mahal: 'Ditagih lebih mahal',
  lebih_murah: 'Ditagih lebih murah',
  qty_beda:    'Jumlah beda',
  tak_ketemu:  'Tak ada di struk',
  tak_pasti:   'Tak pasti',
  sama:        'Sesuai',
};

function photoIdByGrup(i) {
  if (!lastGrup) return null;
  const g = lastGrup.find((x) => x.i === i);
  if (!g) return null;
  for (const idx of g.rowIdx) if (cart[idx] && cart[idx].photoId) return cart[idx].photoId;
  return null;
}

function renderReconcile(hasil) {
  lastReconcile = hasil;
  const jk = hasil.jangkar;
  $('reconcile-summary').innerHTML =
    `<div>Keranjang ${rupiah(hasil.totalKeranjang)} → Struk ${rupiah(hasil.totalStruk)}</div>` +
    `<div class="${hasil.selisih > 0 ? 'rc-diff' : ''}">Selisih ${rupiah(hasil.selisih)}` +
    (hasil.hemat ? ` · Hemat ${rupiah(hasil.hemat)}` : '') + `</div>` +
    (jk.cocok
      ? `<div class="rc-anchor-ok">Angka struk konsisten ✓</div>`
      : `<div class="rc-anchor-bad">⚠ ${rupiah(jk.takTerjelaskan)} tak terjelaskan — coba foto ulang struknya</div>`);

  const baris = (row) => {
    const pid = photoIdByGrup(row.i);
    const aksi = pid
      ? `<span class="rc-actions"><button class="rc-foto" data-id="${pid}" type="button">Foto</button><button class="rc-bukti" data-id="${pid}" type="button">Bukti</button></span>`
      : '';
    let angka;
    if (row.status === 'tak_ketemu') angka = `Keranjang ${rupiah(row.totalKeranjang)}`;
    else if (row.status === 'qty_beda') angka = `Struk ${row.unitStruk} vs scan ${row.unitKeranjang} · ${rupiah(row.selisih)}`;
    else if (row.status === 'sama') angka = `${rupiah(row.totalStruk)} ✓`;
    else if (row.status === 'tak_pasti') angka = `Keranjang ${rupiah(row.totalKeranjang)} · struk tak terbaca`;
    else angka = `Keranjang ${rupiah(row.totalKeranjang)} → Struk ${rupiah(row.totalStruk)} (${rupiah(row.selisih)})`;
    const li = document.createElement('li');
    li.className = 'rc-row' + (row.status === 'lebih_mahal' ? ' rc-beda' : '') +
      (row.status === 'tak_ketemu' || row.status === 'tak_pasti' ? ' rc-nf' : '');
    li.innerHTML = `<span class="rc-nama"></span><span class="rc-price">${angka}</span>` +
      (row.status === 'tak_ketemu' || row.status === 'tak_pasti'
        ? `<span class="rc-actions"><button class="rc-manual" data-i="${row.i}" type="button">Cocokkan manual</button></span>`
        : row.status === 'qty_beda'
          ? `<span class="rc-actions"><button class="rc-qty" data-i="${row.i}" type="button">Perbaiki jumlah</button></span>`
          : aksi);
    li.querySelector('.rc-nama').textContent = row.nama;
    return li.outerHTML;
  };

  const kelompok = (status) => {
    const isi = hasil.rows.filter((r) => r.status === status);
    if (!isi.length) return '';
    const tutup = (status === 'lebih_murah' || status === 'sama') ? ' rc-collapse' : '';
    const tombol = status === 'sama'
      ? '<button id="btn-del-same" class="btn btn-ghost" type="button">Hapus semua foto sesuai</button>' : '';
    return `<h3>${RC_JUDUL[status]} (${isi.length})</h3>${tombol}<ul class="rc-list${tutup}">${isi.map(baris).join('')}</ul>`;
  };

  const barisAsing = (a, idx) => {
    const li = document.createElement('li');
    li.className = 'rc-row rc-asing';
    li.innerHTML = `<span class="rc-nama"></span>` +
      `<span class="rc-price">${a.qty > 1 ? a.qty + ' × ' : ''}${rupiah(a.net)}</span>` +
      `<span class="rc-actions"><button class="rc-add" data-idx="${idx}" type="button">Tambahkan</button></span>`;
    li.querySelector('.rc-nama').textContent = a.nama;
    return li.outerHTML;
  };
  const grupAsing = hasil.asing.length
    ? `<h3>Ada di struk, tak discan (${hasil.asing.length})</h3><ul class="rc-list">${hasil.asing.map(barisAsing).join('')}</ul>`
    : '';

  const html = kelompok('lebih_mahal') + grupAsing + kelompok('qty_beda') +
    kelompok('tak_ketemu') + kelompok('tak_pasti') + kelompok('lebih_murah') + kelompok('sama');
  $('reconcile-body').innerHTML = html || '<p class="muted">Tidak ada hasil rekonsiliasi.</p>';
  wireReconcileButtons();
  saveReconcileToHistory(hasil);
}

function saveReconcileToHistory(hasil) {
  try {
    const snapshot = buildReconcileSnapshot(hasil, Date.now());
    const list = loadHistory();
    if (!list.length) return;
    let entry = list.find((e) => e.sessionId && e.sessionId === cartSessionId);
    if (!entry) entry = list[0];
    entry.reconcile = snapshot;
    localStorage.setItem(HISTORY_STORAGE, JSON.stringify(list));
  } catch (_) {
    showToast('Hasil mungkin tak tersimpan');
  }
}

function buildReconcileSnapshot(hasil, now) {
  const h = hasil || {};
  const rows = Array.isArray(h.rows) ? h.rows : [];
  return {
    v: 2,
    at: now,
    totalKeranjang: h.totalKeranjang || 0,
    totalStruk: h.totalStruk || 0,
    selisih: h.selisih || 0,
    hemat: h.hemat || 0,
    jangkar: {
      cocok: !!(h.jangkar && h.jangkar.cocok),
      takTerjelaskan: (h.jangkar && h.jangkar.takTerjelaskan) || 0,
    },
    rows: rows.map((r) => ({
      nama: r.nama,
      unitKeranjang: r.unitKeranjang,
      unitStruk: r.unitStruk,
      totalKeranjang: r.totalKeranjang,
      totalStruk: r.totalStruk,
      status: r.status,
    })),
    asing: (Array.isArray(h.asing) ? h.asing : []).map((a) => ({ nama: a.nama, qty: a.qty, net: a.net })),
  };
}
function wireReconcileButtons() {
  const body = $('reconcile-body');
  body.querySelectorAll('.rc-foto').forEach((b) => b.addEventListener('click', () => openPhoto(b.dataset.id)));
  body.querySelectorAll('.rc-bukti').forEach((b) => b.addEventListener('click', () => markEvidence(b.dataset.id, b)));
  body.querySelectorAll('.rc-manual').forEach((b) => b.addEventListener('click', () => manualMatch(Number(b.dataset.i))));
  body.querySelectorAll('.rc-qty').forEach((b) => b.addEventListener('click', () => perbaikiJumlah(Number(b.dataset.i))));
  body.querySelectorAll('.rc-add').forEach((b) => b.addEventListener('click', () => tambahDariStruk(Number(b.dataset.idx))));
  const deleteSame = $('btn-del-same');
  if (deleteSame) deleteSame.addEventListener('click', deleteSamePhotos);
}

async function openPhoto(id) {
  const photo = await window.PhotoDB.getPhoto(id);
  if (!photo) { alert('Foto sudah terhapus.'); return; }
  $('photo-view').src = 'data:image/jpeg;base64,' + photo.base64;
  openSheet('sheet-photo');
}

async function markEvidence(id, button) {
  const photo = await window.PhotoDB.getPhoto(id);
  if (!photo) return;
  photo.status = 'evidence';
  photo.expiresAt = null;
  await window.PhotoDB.putPhoto(photo);
  if (button) { button.textContent = 'Bukti ✓'; button.disabled = true; }
}

async function deleteSamePhotos() {
  if (!cartSessionId) return;
  const photos = await window.PhotoDB.getPhotosBySession(cartSessionId);
  for (const photo of photos) if (photo.status === 'matched_same') await window.PhotoDB.deletePhoto(photo.id);
  alert('Foto item yang harganya sesuai telah dihapus.');
}

async function manualMatch(i) {
  // `nama === i` hanya menjaga tes/penyimpan lama yang memanggil fungsi ini
  // langsung; tombol UI selalu mengirim indeks grup.
  const grup = lastGrup && lastGrup.find((entry) => entry.i === i || entry.nama === i);
  if (!grup) return;
  const nama = grup.nama;
  const input = prompt('Harga di struk kasir untuk "' + nama + '" (kosongkan bila memang tak ada):');
  if (input === null) return;
  const hargaKasir = parseInt(input, 10);
  const item = cart.find((entry) => entry.nama === nama);
  const hargaRak = item ? item.harga : 0;
  const rows = lastReconcile && (Array.isArray(lastReconcile) ? lastReconcile : lastReconcile.rows);
  const row = rows && rows.find((entry) => entry.i === grup.i || entry.nama === nama);
  const totalKeranjang = row && row.totalKeranjang !== undefined ? row.totalKeranjang : hargaRak;
  const status = Number.isNaN(hargaKasir) ? 'tak_ketemu'
    : hargaKasir === totalKeranjang ? 'sama'
      : Array.isArray(lastReconcile) ? 'beda'
        : hargaKasir > totalKeranjang ? 'lebih_mahal' : 'lebih_murah';
  await applyReconcileResult({
    rows: [{ i: grup.i, nama, hargaRak, totalStruk: Number.isNaN(hargaKasir) ? 0 : hargaKasir, status }],
  });
  if (row) {
    if (Array.isArray(lastReconcile)) {
      row.hargaKasir = Number.isNaN(hargaKasir) ? null : hargaKasir;
    } else {
      row.totalStruk = Number.isNaN(hargaKasir) ? 0 : hargaKasir;
      row.selisih = row.totalStruk - row.totalKeranjang;
    }
    row.status = status;
  }
  if (lastReconcile) renderReconcile(lastReconcile);
}

// Masukkan baris struk asing ke keranjang, lalu hitung ulang secara lokal dari
// transkripsi yang sama. Tidak ada panggilan Gemini maupun kuota tambahan.
// ponytail: serialkan semua Tambahkan karena cart/riwayat/state sesi bersama;
// gunakan guard per-item hanya bila UI perlu menerima beberapa item bersamaan.
let tambahDariStrukSedangProses = false;
async function tambahDariStruk(idx) {
  if (tambahDariStrukSedangProses || !lastReconcile || !lastBaris) return;
  tambahDariStrukSedangProses = true;
  try {
    const a = lastReconcile.asing[idx];
    if (!a) return;
    const { harga, qty } = barisDariStruk(a.net, a.qty);
    cart.push({ nama: a.nama, harga, qty, promo: null, dariStruk: true });
    persistCart();
    renderCart();
    perbaruiEntriRiwayat();
    lastGrup = grupKeranjang(cart);
    const hasil = reconcileHitung(lastGrup, lastBaris);
    await applyReconcileResult(hasil);
    renderReconcile(hasil);
    showToast('Ditambahkan dari struk');
  } finally {
    tambahDariStrukSedangProses = false;
  }
}

// Tulis ulang komposisi & total entri riwayat sesi ini dari keranjang sekarang.
function perbaruiEntriRiwayat() {
  try {
    const list = loadHistory();
    if (!list.length) return;
    const entry = list.find((e) => e.sessionId && e.sessionId === cartSessionId) || list[0];
    entry.items = cart.map((it) => ({
      nama: it.nama, harga: it.harga, qty: itemQty(it),
      dariStruk: it.dariStruk ? true : undefined,
    }));
    entry.total = cartTotal();
    localStorage.setItem(HISTORY_STORAGE, JSON.stringify(list));
  } catch (_) {
    showToast('Riwayat mungkin tak terbarui');
  }
}

// Buka sheet edit pada baris keranjang pertama dari grup ini. Sengaja TIDAK
// mengubah qty otomatis: struk bisa benar, bisa juga kasir yang salah scan.
function perbaikiJumlah(i) {
  const g = lastGrup && lastGrup.find((x) => x.i === i);
  if (!g || !g.rowIdx.length) return;
  openEdit(g.rowIdx[0]);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ============================================================
   RIWAYAT BELANJA (localStorage)
   Data riwayat TERPISAH dari fungsi scan — bila kosong/rusak,
   scan & keranjang tetap berjalan normal.
   ============================================================ */
function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_STORAGE)) || []; }
  catch (_) { return []; }
}

function recordSession() {
  const list = loadHistory();
  list.unshift({
    ts: Date.now(),
    sessionId: cartSessionId,
    total: cartTotal(),
    items: cart.map((it) => ({ nama: it.nama, harga: it.harga, qty: itemQty(it) })),
  });
  localStorage.setItem(HISTORY_STORAGE, JSON.stringify(list));
}

function fmtDate(ts) {
  const d = new Date(ts);
  const tgl = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  const jam = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  return `${tgl} · ${jam}`;
}

// Tanggal ringkas (tanpa tahun/jam) untuk petunjuk harga: "12 Jun".
function fmtDateShort(ts) {
  return new Date(ts).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}

function openHistory() {
  stopCamera();
  showScreen('screen-history');
  renderHistory();
}

// Hitung & tampilkan ringkasan belanja bulan berjalan (total + jumlah sesi).
// Disembunyikan bila belum ada belanja di bulan ini.
function renderMonthStats(data) {
  const box = $('history-stats');
  if (!box) return;
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  let total = 0, count = 0;
  data.forEach((s) => {
    const d = new Date(s.ts);
    if (d.getFullYear() === y && d.getMonth() === m) { total += s.total; count++; }
  });
  if (count === 0) { box.hidden = true; return; }
  $('stat-month-total').textContent = rupiah(total);
  $('stat-month-count').textContent = count;
  box.hidden = false;
}

function renderHistory() {
  const list = $('history-list');
  const empty = $('history-empty');
  const data = loadHistory();
  list.innerHTML = '';
  renderMonthStats(data);

  if (data.length === 0) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  data.forEach((sesi, i) => {
    const li = document.createElement('li');
    li.className = 'history-item';
    li.innerHTML = `
      <div class="hi-info">
        <span class="hi-date"></span>
        <span class="hi-count"></span>
      </div>
      <span class="hi-total">${rupiah(sesi.total)}</span>`;
    li.querySelector('.hi-date').textContent = fmtDate(sesi.ts);
    li.querySelector('.hi-count').textContent =
      sesi.items.reduce((s, it) => s + itemQty(it), 0) + ' item';
    li.addEventListener('click', () => showHistoryDetail(i));
    list.appendChild(li);
  });
}

async function showHistoryDetail(i) {
  const sesi = loadHistory()[i];
  if (!sesi) return;

  const list = $('hist-detail-list');
  list.innerHTML = '';
  sesi.items.forEach((it) => {
    list.appendChild(lineItem(it));
  });
  decorateHistoryPhotos(list, sesi.items);

  $('hist-detail-title').textContent = fmtDate(sesi.ts);
  $('hist-detail-count').textContent = sesi.items.reduce((s, it) => s + itemQty(it), 0);
  $('hist-detail-total').textContent = rupiah(sesi.total);
  $('btn-share-hist').dataset.index = i;
  $('btn-del-hist').dataset.index = i;

  const rcBox = $('hist-detail-reconcile');
  if (rcBox) {
    const rc = sesi.reconcile;
    if (!rc) {
      rcBox.hidden = true;
    } else if (rc.v !== 2) {
      // Snapshot v1 (sebelum v2.8.0): angkanya memang salah (menjumlahkan tanpa qty)
      // dan TIDAK bisa dihitung ulang — hargaKasir lama adalah nilai bruto. Dirender
      // apa adanya supaya data riwayat lama tak hilang.
      rcBox.hidden = false;
      rcBox.innerHTML =
        `<div class="hist-reconcile-head">Hasil cek struk (format lama)</div>` +
        `<div class="settings-note">Rak ${rupiah(rc.totalRak || 0)} → Kasir ${rupiah(rc.totalKasir || 0)} · Selisih ${rupiah(rc.selisih || 0)}</div>`;
    } else {
      rcBox.hidden = false;
      const hitung = (s) => rc.rows.filter((r) => r.status === s);
      const rinci = (arr, n) => arr.slice(0, n).map((r) => `${r.nama} ${rupiah(r.totalStruk)}`).join(' · ') +
        (arr.length > n ? ` · dan ${arr.length - n} lain` : '');
      const jumlahRp = (arr) => arr.reduce((a, r) => a + Math.abs(r.totalStruk - r.totalKeranjang), 0);
      const blok = [];
      const mahal = hitung('lebih_mahal');
      if (mahal.length) blok.push(`<div class="rc-hist-row"><strong>Lebih mahal (${mahal.length})</strong> ${rinci(mahal, 3)}</div>`);
      if (rc.asing && rc.asing.length) {
        blok.push(`<div class="rc-hist-row"><strong>Tak discan (${rc.asing.length})</strong> ` +
          rc.asing.slice(0, 3).map((a) => `${a.nama} ${rupiah(a.net)}`).join(' · ') +
          (rc.asing.length > 3 ? ` · dan ${rc.asing.length - 3} lain` : '') + `</div>`);
      }
      const qtyBeda = hitung('qty_beda');
      if (qtyBeda.length) blok.push(`<div class="rc-hist-row"><strong>Jumlah beda (${qtyBeda.length})</strong> ${rinci(qtyBeda, 3)}</div>`);
      const nf = hitung('tak_ketemu').concat(hitung('tak_pasti'));
      if (nf.length) blok.push(`<div class="rc-hist-row"><strong>Tak ketemu (${nf.length})</strong> ${rinci(nf, 3)}</div>`);
      const murah = hitung('lebih_murah');
      if (murah.length) blok.push(`<div class="rc-hist-row"><strong>Lebih murah (${murah.length})</strong> total ${rupiah(jumlahRp(murah))}</div>`);
      const sama = hitung('sama');
      if (sama.length) blok.push(`<div class="rc-hist-row"><strong>Sesuai (${sama.length})</strong></div>`);
      rcBox.innerHTML =
        `<div class="hist-reconcile-head">Hasil cek struk</div>` +
        `<div class="settings-note">Keranjang ${rupiah(rc.totalKeranjang)} → Struk ${rupiah(rc.totalStruk)}</div>` +
        `<div class="settings-note">Selisih ${rupiah(rc.selisih)}${rc.hemat ? ` · Hemat ${rupiah(rc.hemat)}` : ''}</div>` +
        blok.join('');
    }
  }

  openSheet('sheet-history-detail');
}

async function decorateHistoryPhotos(sessionItemsEl, items) {
  if (!window.PhotoDB) return;
  const all = await window.PhotoDB.getAllPhotos();
  const idByNama = {};
  all.forEach((photo) => { idByNama[photo.nama] = photo.id; });
  items.forEach((item, index) => {
    const photoId = idByNama[item.nama];
    const li = sessionItemsEl.children[index];
    if (!photoId || !li) return;
    const button = document.createElement('button');
    button.className = 'hist-foto';
    button.type = 'button';
    button.textContent = 'Foto';
    button.setAttribute('aria-label', 'Lihat foto rak');
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      openPhoto(photoId);
    });
    li.appendChild(button);
  });
}

function clearHistory() {
  if (loadHistory().length === 0) return;
  if (!confirm('Hapus semua riwayat belanja? Tindakan ini tidak bisa dibatalkan.')) return;
  localStorage.removeItem(HISTORY_STORAGE);
  renderHistory();
}

// Hapus satu sesi riwayat (dari sheet detail). Indeks = posisi di array
// tersimpan (urutan terbaru-dulu), sama dengan yang dipakai saat render.
function deleteSession() {
  const i = parseInt($('btn-del-hist').dataset.index, 10);
  const data = loadHistory();
  if (!data[i]) return;
  if (!confirm('Hapus belanja ini dari riwayat?')) return;
  data.splice(i, 1);
  localStorage.setItem(HISTORY_STORAGE, JSON.stringify(data));
  closeSheet('sheet-history-detail');
  renderHistory();
}

/* ============================================================
   BAGIKAN & EKSPOR
   Bagikan: rangkai daftar belanja jadi teks → Web Share API (muncul
   pilihan WhatsApp/dll). Bila peramban tak punya navigator.share,
   jatuh ke tautan wa.me. Ekspor: seluruh riwayat → berkas CSV.
   ============================================================ */

// Rangkai daftar item + total jadi teks siap-bagi (dipakai ringkasan & riwayat).
function buildShareText(items, total, ts) {
  const baris = items.map((it) => {
    const q = itemQty(it);
    const rinci = q > 1 ? `${q} × ${rupiah(it.harga)} = ${rupiah(itemSub(it))}` : rupiah(itemSub(it));
    return `• ${it.nama} — ${rinci}`;
  });
  const unit = items.reduce((s, it) => s + itemQty(it), 0);
  return [
    '🛒 Belanja Keranjang Pintar',
    fmtDate(ts),
    '',
    ...baris,
    '',
    `Total: ${rupiah(total)} (${unit} item)`,
  ].join('\n');
}

async function shareList(items, total, ts) {
  if (!items || items.length === 0) return;
  const text = buildShareText(items, total, ts);
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Belanja Keranjang Pintar', text });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return; // user batal → jangan buka fallback
      // error lain (mis. tak diizinkan) → lanjut ke fallback wa.me
    }
  }
  window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
}

// Bagikan keranjang yang sedang aktif (dari sheet Ringkasan).
function shareSummary() { shareList(cart, cartTotal(), Date.now()); }

// Bagikan satu sesi riwayat (dari sheet Detail Riwayat). Indeks disimpan
// di dataset tombol saat detail dibuka.
function shareHistory() {
  const i = parseInt($('btn-share-hist').dataset.index, 10);
  const sesi = loadHistory()[i];
  if (sesi) shareList(sesi.items, sesi.total, sesi.ts);
}

// Bungkus satu sel CSV: kutip bila mengandung koma, kutip, atau baris baru.
function csvCell(v) {
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function exportHistoryCsv() {
  const data = loadHistory();
  if (data.length === 0) return;
  // Satu baris per item, plus kolom info sesi → mudah dipivot di spreadsheet.
  const rows = [['Tanggal', 'Barang', 'Harga', 'Jumlah', 'Subtotal', 'Promo']];
  data.forEach((sesi) => {
    sesi.items.forEach((it) => {
      const q = itemQty(it);
      rows.push([fmtDate(sesi.ts), it.nama, it.harga, q, itemSub(it), it.promo ? it.promo.label : '']);
    });
  });
  const csv = rows.map((r) => r.map(csvCell).join(',')).join('\n');
  // ﻿ (BOM) agar Excel membaca UTF-8 → nama barang ber-aksen tetap benar.
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const d = new Date();
  const tgl = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  a.href = url;
  a.download = `keranjang-pintar-riwayat-${tgl}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
