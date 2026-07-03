# Changelog

Semua perubahan penting pada proyek ini dicatat di berkas ini.

Format mengikuti [Keep a Changelog](https://keepachangelog.com/id-ID/1.1.0/),
dan proyek ini menganut [Semantic Versioning](https://semver.org/lang/id/).

## [2.1.1] - 2026-07-03

### Ditambahkan

- **Tombol galeri di dashboard demo mode.** Pengguna demo sekarang bisa langsung memilih gambar dari galeri tanpa harus masuk ke Pengaturan. Tombol "Uji dari Galeri" muncul di bawah tombol "Tambah Item" dengan gaya subtle (opacity 0.5) agar tidak mengganggu CTA utama.

## [2.1.0] - 2026-07-02

### Ditambahkan / Keamanan

- **Demo Mode aman via proxy serverless.** Demo tidak lagi menyimpan API key Gemini di `app.js`; key demo berada di Cloudflare Worker secret.
- **Limit demo server-side.** Demo dibatasi 50 scan sukses per perangkat per hari, 150 scan sukses per IP per hari, dan cooldown 5 detik per perangkat.
- **Rotasi 3 akun demo di server.** Worker melakukan round-robin, melewati key yang terkena 429, dan menonaktifkan key yang 401/403.
- **BYOK tetap lokal.** Pengguna yang memakai API key sendiri tetap memanggil Gemini langsung dari browser seperti sebelumnya.

## [2.0.1] - 2026-06-30

### Diubah / Keamanan

- **Demo Mode dimatikan sementara.** Ketiga API key demo yang di-hardcode di
  `app.js` pada v2.0 **dicabut otomatis oleh Google** karena terdeteksi di repo
  publik (risiko yang sudah diantisipasi). Konsekuensinya Demo Mode tak bisa
  jalan, jadi dimatikan lewat satu kill-switch `DEMO_AVAILABLE = false` agar app
  LIVE tak menampilkan fitur yang rusak. Aplikasi kini **BYOK-only**: tiap user
  pakai API key Gemini sendiri (gratis dari Google AI Studio).
- **Key mati dibuang dari kode sumber.** `DEMO_KEYS` dikosongkan; tidak ada lagi
  kredensial di repo.
- **Pelajaran arsitektur:** key di sisi-client tidak bisa bertahan di static
  site publik — apa pun yang ditaruh di sana akan discan & dicabut lagi. Demo
  akan dihidupkan lagi nanti lewat **proxy serverless** (key jadi secret di
  server, tak pernah sampai ke browser). Kode demo dibiarkan utuh agar tinggal
  membalik kill-switch saat proxy siap.

### Migrasi

- User yang sebelumnya berada di Demo Mode (tanpa key sendiri) kini diarahkan ke
  layar Selamat Datang untuk memasang API key sendiri. Keranjang & riwayat tetap
  utuh (storage terpisah). User lama yang sudah punya key tak terpengaruh.

## [2.0.0] - 2026-06-29

### Ditambahkan

- **Demo Mode — langsung scan tanpa API key sendiri.** User baru kini bisa
  mencoba seketika lewat tombol "Mulai dengan Demo" di layar Selamat Datang
  baru. Di balik layar, 3 API key demo dirotasi **round-robin** (bagi beban
  rata antar key); bila satu key kena 429, request lompat ke key berikutnya
  (maksimal satu putaran). Membagi beban rata membuat tiap key jarang mentok
  RPM — pola terlihat wajar, paling aman dari ban.
- **Onboarding baru (layar Selamat Datang).** Dua pilihan: "Mulai dengan Demo"
  (tombol utama, mencolok) dan "Pakai API Key Sendiri" (sekunder). Demo jadi
  jalur utama; key sendiri tetap tersedia untuk pemakaian tak terbatas.
- **Kuota lokal demo: 50 scan/perangkat/hari + cooldown 5 detik.** Mencegah
  pemakaian berlebih dan menjaga RPM tiap key tetap aman. Badge demo di
  dashboard menampilkan "Demo · N/50 scan" dengan warna hijau (<30), kuning
  (30–40), merah (>40), serta hitung mundur cooldown.
- **Pindah mode dua arah.** Dari pengaturan bisa "Ganti ke Key Sendiri" atau
  "Ganti ke Demo" kapan saja; keranjang & riwayat tetap utuh saat berpindah.
- **Pesan saat kuota habis** bernada ramah ("Kuota demo habis hari ini. Coba
  lagi besok atau pakai key sendiri.") dengan aksi Input Manual / Pakai Key
  Sendiri.

### Diubah

- `callGemini` kini menerima API key sebagai argumen (sebelumnya selalu
  membaca key tersimpan), supaya rotasi key demo bisa menukar key per
  percobaan. Mode key sendiri memanggilnya dengan key user — perilaku tak
  berubah bagi mereka.

### Catatan migrasi

- **User lama termigrasi senyap.** Yang sudah punya API key tersimpan langsung
  masuk dashboard mode "key sendiri" seperti biasa — tanpa melihat layar
  onboarding baru, tanpa kehilangan akses. Tidak ada breaking change bagi user.

## [1.4.2] - 2026-06-29

### Diperbaiki

- **Header & footer dashboard kini terkunci, hanya daftar yang bergulir.**
  Saat keranjang panjang (mis. 39 item belanja), seluruh halaman ikut
  memanjang sehingga tombol "Tambah Item" & footer terdorong keluar layar —
  harus geser ke bawah dulu untuk menambah item. Penyebab: `.screen` memakai
  `min-height: 100dvh` sehingga section memanjang mengikuti isi, membuat
  `overflow-y: auto` pada `.cart-list` tak pernah aktif. Diperbaiki dengan
  memberi tinggi pasti `height: 100dvh` + `overflow: hidden` khusus
  `#screen-dashboard` & `#screen-history`, sehingga topbar dan footer diam
  sementara hanya daftar isi yang bergulir di dalam. Berlaku juga untuk daftar
  Riwayat yang panjang.

## [1.4.1] - 2026-06-24

### Dokumentasi

- **README diakuratkan.** Diselaraskan dengan keadaan app sekarang: ditambah
  bagian fitur (input manual, atur jumlah, anggaran, riwayat + ekspor CSV,
  bagikan daftar, bisa dipasang sebagai PWA), "Isi folder" dilengkapi jadi
  10 berkas (sebelumnya cuma 4) plus catatan mana yang dipakai app vs cuma
  resep ikon, dan petunjuk host sendiri diperbaiki agar `manifest.json`,
  `sw.js`, serta ikon ikut terunggah. Memperbaiki klaim keliru "keranjang
  tidak disimpan permanen" — kini dibedakan jelas antara keranjang aktif
  (sesi), Riwayat (permanen), dan API key (permanen).
- **Bahasa README dirapikan & langkah API key diperjelas.** Beberapa kalimat
  diperhalus ("buat" → "untuk", langkah pertama alur disederhanakan jadi
  "langsung buka link di atas"), penjelasan keranjang aktif dipertegas (item
  bertahan sampai sesi belanja diselesaikan), dan langkah ambil API key Gemini
  diperinci: login dengan akun Google, buka sidebar kiri → klik ikon kunci di
  bawah, lalu di halaman baru klik "Create API key".
- **Tutor halaman setup diselaraskan.** Panduan "Belum punya API key?" di
  `index.html` mengikuti langkah baru (sidebar → ikon kunci → halaman baru →
  Create API key), tidak lagi menyebut tombol "Get API Key" yang sudah usang.

## [1.4.0] - 2026-06-23

### Changed

- **Set ikon baru senada palet.** Semua emoji warna-warni (🕘 ⚙ 📷 🖼 ⬇ 🗑 📤
  ⚡ 🏷) diganti **ikon garis (SVG line)** yang mewarisi warna teks lewat
  `currentColor`, jadi selalu serasi palet "Ungu Lembut". Satu sumber kebenaran
  di `app.js` (`ICONS` + `svgIcon()`), tombol statis dihidrasi via `[data-icon]`.
- **Uji Galeri pindah ke Pengaturan.** Tombol "Uji dari Galeri" dikeluarkan dari
  footer dashboard ke sheet Pengaturan supaya tampilan keranjang lebih simpel;
  "Input Manual" dan "Selesai" kini sebaris.
- **Indikator kuota lebih halus.** Status Siap/Limit/RPM kini ikon + label
  sebaris, bukan emoji.

### Added

- **Atmosfer & kedalaman.** Cahaya aksen lembut menyebar dari atas layar
  (radial gradient dalam palet), memberi dimensi tanpa mengubah warna dasar.
- **Reveal bertahap.** Saat dashboard/riwayat terbuka, elemennya muncul dengan
  fade-up berurutan. Menghormati `prefers-reduced-motion`.
- **Empty state berikon.** Keranjang & riwayat kosong kini menampilkan ikon
  garis lembut di atas teks.

## [1.3.0] - 2026-06-23

### Added

- **Aplikasi web progresif (PWA).** Tambah `manifest.json`, ikon (SVG + PNG
  192/512, maskable-safe), dan service worker (`sw.js`). Keranjang Pintar kini
  bisa **dipasang ke home screen** dan tampil layar penuh seperti app biasa.
  Strategi cache *network-first*: saat online selalu ambil versi terbaru (deploy
  sering), saat offline jatuh ke cache sehingga **input manual, keranjang, dan
  riwayat tetap jalan tanpa internet** (scan tetap butuh internet karena
  memanggil Gemini).
- **Hapus riwayat per sesi.** Tombol 🗑 Hapus di detail belanja menghapus satu
  sesi saja (dengan konfirmasi), tak perlu menghapus seluruh riwayat.
- **Statistik bulanan.** Kartu di atas daftar riwayat menampilkan total belanja
  bulan berjalan dan jumlah sesinya; tersembunyi bila belum ada belanja bulan ini.
- **Pelacakan harga.** Saat hasil scan muncul, bila barang dengan nama sama
  pernah dibeli, tampil petunjuk **"🏷 Terakhir dibeli Rp X · tgl"** — mudah
  memantau harga naik/turun antar belanja. Pencocokan nama diabaikan huruf
  besar/kecil dan spasi tepi.

## [1.2.2] - 2026-06-23

### Fixed

- **Hasil scan tak lagi hilang karena salah pencet di luar sheet.** Sebelumnya
  menyentuh area gelap di luar sheet hasil scan (yang menutupi tombol histori/
  pengaturan di belakang) langsung menutup sheet dan membuang item — padahal
  user berniat menambahkannya. Kini sheet hasil scan hanya bisa ditutup lewat
  tombol eksplisit **"Batal"** atau **"Tambah ke Keranjang"**, jadi ketukan tak
  sengaja tidak menghanguskan item. Sheet lain tetap bisa ditutup via backdrop.

## [1.2.1] - 2026-06-23

### Fixed

- **Indikator kuota RPM kini bertahan menembus refresh.** Sebelumnya hitungan
  RPM hanya di memori sehingga reload menyetelnya ulang ke "⚡ Siap" — masalah
  ini jadi kentara setelah keranjang anti-hilang (v1.2.0) membuat refresh di
  tengah belanja jadi hal biasa. Timestamp request sekarang ikut disimpan di
  `localStorage` (`bco_rpm`) dan dipulihkan saat app dibuka, dengan timestamp
  yang sudah lewat 60 detik tetap dibuang agar jendela RPM tetap akurat.

## [1.2.0] - 2026-06-23

### Added

- **Keranjang anti-hilang.** Isi keranjang dan anggaran sesi kini otomatis
  tersimpan di `localStorage` tiap kali berubah, lalu dipulihkan saat app
  dibuka lagi. Tutup tab, refresh, atau HP restart di tengah belanja tidak
  lagi membuat keranjang lenyap — belanja bisa dilanjutkan. Simpanan dibuang
  saat "Belanja Baru". Catatan: menghapus cache/data situs di browser tetap
  menghapus keranjang ini (sama seperti API key & riwayat), karena app statis
  tanpa backend.
- **Bagikan daftar belanja.** Tombol "📤 Bagikan" di ringkasan belanja dan
  detail riwayat merangkai daftar item + total jadi teks dan membuka Web Share
  (pilih WhatsApp dll). Peramban tanpa Web Share jatuh ke tautan `wa.me`.
- **Ekspor riwayat ke CSV.** Tombol ⬇ di layar Riwayat mengunduh seluruh
  riwayat belanja sebagai berkas CSV (kolom: Tanggal, Barang, Harga, Jumlah,
  Subtotal; satu baris per item) — siap dibuka di spreadsheet. Berkas memakai
  BOM UTF-8 agar nama ber-aksen terbaca benar di Excel.

## [1.1.1] - 2026-06-23

### Changed

- Rapikan footer dashboard yang terlalu padat: bar anggaran tidak lagi jadi
  kotak terpisah, melainkan **menyatu dengan baris Total**. "sisa/lewat Rp X"
  menempel di bawah angka total dan bar tipis berwarna-tingkat muncul hanya
  bila anggaran diatur (saat belum diatur, bar disembunyikan dan tampil
  petunjuk samar "atur anggaran"). Mengurangi satu blok dari footer tanpa
  mengubah logika anggaran/konfirmasi. ([079a972])

## [1.1.0] - 2026-06-23

### Added

- **Jumlah (qty) per item.** Tiap item kini punya jumlah, dengan stepper
  `−  1  +` di sheet hasil scan dan sheet edit. Beli beberapa unit barang yang
  sama cukup scan sekali lalu set jumlahnya — hemat scan & kuota. Baris
  keranjang menampilkan `q × harga` (hanya bila >1) dengan subtotal di kanan;
  total, ringkasan, dan riwayat menghitung `harga × jumlah`. Hitungan "item"
  kini menghitung total unit, bukan jumlah baris. Item riwayat lama tanpa
  jumlah otomatis dianggap 1 (tak ada migrasi data).
- **Anggaran belanja per sesi.** Tombol bar anggaran di dashboard: ketuk untuk
  set batas (mis. Rp 200.000). Bar mengisi sesuai pemakaian dengan tiga
  tingkat — ungu (aman), **oranye saat ≥80%** ("sisa Rp X"), **merah saat
  lewat** ("lewat Rp X"). Saat menambah/menaikkan item yang membuat total
  menembus batas, muncul konfirmasi sekali (tidak mengulang setelah kadung
  lewat). Anggaran bersifat per sesi: otomatis ter-reset saat "Belanja Baru",
  selaras dengan keranjang. Tidak disimpan ke localStorage.

## [1.0.0] - 2026-06-23

### Changed

- **Ganti nama aplikasi** dari "BelanjaCatat Online" menjadi **"Keranjang
  Pintar"**. Nama lama terasa kurang pas; nama baru memosisikan app sebagai
  asisten belanja (bukan sekadar pencatat) dan memberi ruang untuk fitur
  lanjutan (anggaran, jumlah per item, pelacakan harga). Judul, brand layar
  setup, judul tab, dan teks versi disesuaikan. Prefix `localStorage` `bco_`
  sengaja **dipertahankan** agar API key & riwayat user yang sudah ada tidak
  hilang setelah rename.
- Repo dan URL GitHub Pages pindah dari `belanja-online` ke `keranjang-pintar`
  (`https://kannnnna9.github.io/keranjang-pintar/`). README diselaraskan.

### Removed

- Buang instruksi & troubleshooting untuk API key format lama (`AIza…`),
  termasuk pengaturan HTTP referrer restriction. Panduan kini hanya
  mengarahkan pembuatan key baru format `AQ.` yang otomatis terbatas ke
  Generative Language API, jadi tak perlu konfigurasi tambahan.

## [0.5.0] - 2026-06-22

### Changed

- Pin model scan ke `gemini-3.1-flash-lite` (sebelumnya alias
  `gemini-flash-latest`). Pengecekan kuota free-tier di AI Studio menunjukkan
  `gemini-flash-latest` kini menunjuk Gemini 3.5 Flash dengan batas hanya
  **20 request per hari (RPD)** — tak cukup untuk satu sesi belanja (struk bisa
  50 item = 50 scan). Gemini 3.1 Flash Lite jauh lebih longgar: **15 RPM,
  500 RPD**, dan akurasi baca label tetap 100%. Id stabil dipilih (bukan alias
  `-latest`) agar tak hot-swap ke rilis ber-limit lebih ketat. ([57cf85f])
- Foto label di-crop ke kotak scan 5:3 sebelum dikirim; area di luar kotak
  tidak ikut dikirim. Resolusi diturunkan ke maksimal 800px lebar dengan
  kualitas JPEG 0,75 (dari 1280px / 0,85) untuk memangkas ukuran payload dan
  token gambar Gemini. ([57cf85f])

### Added

- Indikator kuota di dashboard: "⚡ Siap" saat idle, "⏳ N/15 RPM" mengikuti
  jumlah request dalam 60 detik terakhir, "❌ Limit" saat kena 429. Pemakaian
  harian (RPD) ditampilkan di halaman Pengaturan (N/500), reset otomatis tiap
  ganti hari. ([57cf85f])
- Tombol "🖼 Uji Galeri" di dashboard: pilih gambar dari penyimpanan lalu
  kirim ke pipeline scan yang sama (crop 5:3 + turun resolusi); hasilnya bisa
  diedit dan masuk keranjang seperti hasil kamera. ([57cf85f])

## [0.4.0] - 2026-06-22

### Changed

- Kembalikan model scan ke `gemini-flash-latest` (Flash penuh). Eksperimen
  `gemini-flash-lite-latest` menunjukkan akurasi sama persis (100% pada label
  uji) tetapi latensi tidak konsisten: sekitar separuh scan kena cold-start
  free-tier, kasus terburuk 16,7 detik. Flash penuh konsisten 2–3,4 detik
  tanpa lonjakan, jadi dipilih demi prediktabilitas. ([main])

### Added

- Timeout per percobaan + auto-retry saat scan: percobaan pertama dipotong di
  6 detik untuk memangkas lonjakan cold-start, retry kedua diberi tenggang 12
  detik. Sebagai jaring pengaman; pada Flash penuh yang ~3 detik nyaris tak
  pernah terpicu. ([f33760d])

### Removed

- Buang teks diagnostik sementara (`· 2.3s · 55KB · x1`) dari judul sheet
  hasil; kembali ke "Hasil Scan" bersih. ([main])

## [0.3.0] - 2026-06-21

### Added

- Riwayat belanja tersimpan di `localStorage` (`bco_history`). Tiap kali
  "Selesai", sesi belanja dicatat (tanggal, jumlah item, total). Halaman
  Riwayat menampilkan daftar sesi; ketuk satu sesi untuk lihat detail item,
  dan ada tombol "Hapus Riwayat". Data terpisah dari fungsi scan. ([674a20a])
- Edit item di keranjang: ketuk baris item untuk ubah nama dan harga, total
  diperbarui otomatis. ([674a20a])

### Changed

- Area scan kamera kini kotak horizontal rasio 5:3 di tengah layar dengan
  border aksen dan sudut melengkung; area di luarnya digelapkan. Aplikasi
  tetap portrait, hanya kotak scan yang landscape. ([674a20a])

## [0.2.2] - 2026-06-21

### Changed

- Ganti model Gemini ke alias `gemini-flash-latest` supaya selalu menunjuk
  ke Flash terbaru yang masih punya free tier. `gemini-2.0-flash` dimatikan
  Google 1 Juni 2026, sehingga free tier-nya jadi `limit:0` dan tiap scan
  gagal "quota exceeded". ([5cf5ba4])
- Kamera dimatikan saat loading scan (frame terakhir membeku), tidak lagi
  jalan di latar selama AI memproses. Dinyalakan lagi hanya bila user
  batal/tutup hasil saat masih di layar kamera. ([ede8107])
- Selaraskan README dan tutorial setup in-app dengan kondisi terkini:
  format key `AQ.` (auto-restrict) vs `AIza` lama, penjelasan alias model,
  dan bagian troubleshooting "Jika Scan Gagal". ([71d6ad3], [9160343])

## [0.2.1] - 2026-06-21

### Fixed

- Pesan error scan asli (mis. 400 API key / 403 referrer) kini tampil di
  dalam sheet hasil (`#res-error`). Sebelumnya ditulis ke `#cam-error` yang
  ketutup sheet, sehingga sheet tampak kosong tanpa alasan. ([cba4120])

## [0.2.0] - 2026-06-21

### Added

- Alur aplikasi setup → dashboard → kamera. ([c05cd6d])

## [0.1.1] - 2026-06-21

### Changed

- Kirim API key Gemini lewat header `x-goog-api-key`. ([5fd5685])

## [0.1.0] - 2026-06-21

### Added

- Inisialisasi BelanjaCatat Online: aplikasi statis BYOK untuk scan label
  harga di rak lewat kamera, nama dan harga dibaca otomatis oleh Gemini.
  ([a41a163])

[1.3.0]: https://github.com/kannnnna9/keranjang-pintar/compare/be9e5f2...main
[1.2.2]: https://github.com/kannnnna9/keranjang-pintar/compare/883e06f...be9e5f2
[1.2.1]: https://github.com/kannnnna9/keranjang-pintar/compare/e211d12...883e06f
[1.2.0]: https://github.com/kannnnna9/keranjang-pintar/compare/9d5d039...e211d12
[1.1.1]: https://github.com/kannnnna9/keranjang-pintar/compare/0a8bb61...9d5d039
[1.1.0]: https://github.com/kannnnna9/keranjang-pintar/compare/4d24410...0a8bb61
[1.0.0]: https://github.com/kannnnna9/keranjang-pintar/compare/57cf85f...4d24410
[0.5.0]: https://github.com/kannnnna9/keranjang-pintar/commit/57cf85f
[0.4.0]: https://github.com/kannnnna9/keranjang-pintar/compare/bca2427...main
[0.3.0]: https://github.com/kannnnna9/keranjang-pintar/compare/ede8107...674a20a
[0.2.2]: https://github.com/kannnnna9/keranjang-pintar/compare/cba4120...ede8107
[0.2.1]: https://github.com/kannnnna9/keranjang-pintar/compare/c05cd6d...cba4120
[0.2.0]: https://github.com/kannnnna9/keranjang-pintar/compare/5fd5685...c05cd6d
[0.1.1]: https://github.com/kannnnna9/keranjang-pintar/compare/a41a163...5fd5685
[0.1.0]: https://github.com/kannnnna9/keranjang-pintar/commit/a41a163

[a41a163]: https://github.com/kannnnna9/keranjang-pintar/commit/a41a163
[5fd5685]: https://github.com/kannnnna9/keranjang-pintar/commit/5fd5685
[c05cd6d]: https://github.com/kannnnna9/keranjang-pintar/commit/c05cd6d
[cba4120]: https://github.com/kannnnna9/keranjang-pintar/commit/cba4120
[5cf5ba4]: https://github.com/kannnnna9/keranjang-pintar/commit/5cf5ba4
[71d6ad3]: https://github.com/kannnnna9/keranjang-pintar/commit/71d6ad3
[9160343]: https://github.com/kannnnna9/keranjang-pintar/commit/9160343
[ede8107]: https://github.com/kannnnna9/keranjang-pintar/commit/ede8107
[674a20a]: https://github.com/kannnnna9/keranjang-pintar/commit/674a20a
[f33760d]: https://github.com/kannnnna9/keranjang-pintar/commit/f33760d
[57cf85f]: https://github.com/kannnnna9/keranjang-pintar/commit/57cf85f
[main]: https://github.com/kannnnna9/keranjang-pintar/commits/main
