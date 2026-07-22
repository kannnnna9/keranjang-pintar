/* ============================================================
   Keranjang Pintar — Service Worker
   Strategi network-first untuk app shell: saat online selalu ambil versi
   terbaru (deploy sering, jadi hindari user kejebak versi lama), lalu
   simpan ke cache; saat offline jatuh ke cache → input manual, keranjang,
   dan riwayat tetap jalan tanpa internet. Scan tetap butuh internet
   (panggilan Gemini cross-origin sengaja tak disentuh SW).
   Cache diberi versi: ganti nomor ini tiap rilis agar cache lama dibuang.
   ============================================================ */
const CACHE = 'kp-cache-v2.5.0';
const SHELL = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'retention.js',
  'db.js',
  'manifest.json',
  'icon-192.png',
  'icon-512.png',
  'icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  // Hanya tangani GET same-origin. Request lain (mis. POST ke Gemini di
  // host lain) dibiarkan lewat ke jaringan seperti biasa.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  e.respondWith(
    fetch(req)
      .then((res) => {
        // Berhasil online → perbarui cache lalu kembalikan.
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(async () => {
        // Offline → ambil dari cache; untuk navigasi, jatuh ke index.html.
        const hit = await caches.match(req);
        return hit || caches.match('index.html');
      })
  );
});
