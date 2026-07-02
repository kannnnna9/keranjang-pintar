# Keranjang Pintar

Catat belanja pakai kamera. Foto label harga di rak, AI-nya (Google Gemini) baca nama barang sama harganya, langsung masuk keranjang. Tinggal jepret, nggak usah ngetik satu-satu.

Dibuat untuk belanja di supermarket dan minimarket — di mana barang ditata di rak dengan label harga.

Appnya jalan di browser. Kalau pakai API key sendiri, key itu cuma disimpan di browsermu. Mode Demo lewat proxy serverless supaya key demo tidak pernah masuk ke browser.

## Buat kamu yang cuma mau nyatet belanja

Nggak usah bikin repo atau install apa-apa. Tinggal buka ini di HP:

**https://kannnnna9.github.io/keranjang-pintar/**

Pertama kali buka, kamu bisa pilih Demo atau pakai API key Gemini sendiri. Kalau pilih key sendiri, tempel sekali dan habis itu kepakai terus di HP itu.

Alurnya:

1. Langsung aja buka link di atas.
2. Tempel API key, pencet Simpan & Mulai.
3. Kamu masuk ke halaman keranjang. Ini halaman utamanya, sekaligus tempat liat daftar belanja sama totalnya. Awalnya masih kosong.
4. Pencet "Tambah Item" buat buka kamera (kasih izin kamera kalau diminta). Arahkan ke label harga, pastiin tulisannya masuk bingkai, terus pencet tombol rana. Tunggu sebentar AI-nya baca.
5. Cek hasilnya. Kalau nama atau harganya meleset, betulin langsung di situ, atur jumlahnya kalau ambil lebih dari satu, baru Tambah ke Keranjang. Habis itu balik sendiri ke keranjang, item sama totalnya udah keupdate.
6. Ulangi buat barang lain. Atau pakai "Input Manual" kalau mau ketik sendiri tanpa kamera.
7. Kalau udah kelar, pencet Selesai buat liat ringkasan (jumlah item + total belanja). Begitu ditutup, belanja itu otomatis tersimpan ke Riwayat.

## Yang bisa dilakukan selain scan

- **Input manual** — ketik nama & harga sendiri kalau labelnya susah difoto.
- **Atur jumlah** — ambil 3 barang yang sama? naikin qty-nya, totalnya ngitung sendiri.
- **Anggaran** — pasang batas belanja, ada bar yang nunjukin sisa anggaranmu selama belanja.
- **Riwayat** — tiap belanja yang udah Selesai kesimpen sendiri, lengkap sama statistik "belanja bulan ini". Bisa diekspor ke CSV.
- **Bagikan daftar** — kirim ringkasan belanja ke WhatsApp atau aplikasi lain.
- **Bisa dipasang** — dari menu browser pilih "Add to Home Screen", nanti muncul kayak app beneran. Kerangkanya juga di-cache, jadi kebuka cepat walau sinyal lagi lemah (tapi buat scan tetap butuh internet, karena nyambung ke Gemini).

Hal-hal yang "kesimpen" di browser mu:

- **Keranjang yang lagi jalan** item yang udah masuk keranjang bakal kesimpen sampai kamu menyelesaikan sesi belanja.
- **Riwayat** belanja yang udah kamu Selesai-kan disimpan permanen di browsermu, sampai kamu hapus sendiri.
- **API key** juga tetap kesimpen, jadi nggak perlu tempel ulang.

## Ambil API key Gemini (gratis)

1. Buka https://aistudio.google.com, login dengan akun Google kamu.
2. Buka sidebar di sebelah kiri, klik icon kunci dibagian bawah.
3. Lalu pada halaman baru, klik "Create API key", pilih project atau bikin baru.
4. Salin key-nya. Key baru bentuknya diawali `AQ.`.
5. Tempel ke app.

Jatah gratisnya cukup buat belanja harian.

Key `AQ.` udah otomatis aman: dia kebatasi ke Generative Language API sejak dibuat, jadi nggak usah atur apa-apa lagi. Tinggal tempel dan jalan.

Soal "gratis": kebanyakan akun Google biasa langsung jalan. Tapi sebagian kecil akun kadang diblokir otomatis sama Google (muncul "project has been denied access"). Itu salah deteksi dari pihak Google, bukan masalah appnya. Kalau kamu kena, lihat bagian "Kalau scan gagal" di bawah.

## Kalau scan gagal

Pesan error asli dari Google muncul di panel hasil, warnanya merah. Baca itu buat tau masalahnya:

- Muncul "You exceeded your current quota" atau "limit: 0": kuota model lagi habis. App ini pakai `gemini-3.1-flash-lite` yang jatah gratisnya longgar (15 request/menit, 500/hari), jadi mestinya jarang kejadian. Kalau tetap muncul, tunggu kuotanya reset (tengah malam waktu Pasifik, sekitar jam 2 siang WIB).
- Muncul "Your project has been denied access": akunmu kena blokir otomatis Google. App sama key-mu sebenernya nggak salah. Yang bisa dicoba, dari yang paling gampang: (1) pakai API key dari akun Google lain; (2) aktifin billing di project Cloud-mu, tetap gratis selama pemakaian di bawah limit, cuma project yang ada billing-nya lebih dipercaya Google jadi lolos blokir; (3) minta ditinjau di forum https://discuss.ai.google.dev, tapi ini lama.
- Muncul "API key not valid": key-nya salah atau ada spasi keikut. Tempel ulang lewat ⚙ > Ganti API Key.
- Kamera nggak nongol: pastiin halaman dibuka lewat HTTPS dan izin kameranya udah dikasih.

## Mau host sendiri? (opsional)

Buat kebanyakan orang, cukup pakai link di atas. Tapi kalau kamu pengen punya salinan sendiri, misalnya mau ngoprek kodenya, pakai domain sendiri, atau biar yakin nggak ada kode aneh, caranya gampang:

1. Bikin repo baru, upload **semua isi folder ini** — jangan cuma sebagian. `manifest.json`, `sw.js`, sama file ikonnya perlu ikut, kalau enggak nanti app nggak bisa dipasang dan ikonnya rusak.
2. Di Settings > Pages, pilih branch (misal `main`) folder root.
3. Tunggu URL-nya keluar: `https://NAMA-AKUN.github.io/NAMA-REPO/`.
4. Buka di HP.

## Isi folder

```
keranjang-pintar/
├── index.html      UI semua layar + layar setup key
├── style.css       Tampilan (palet "Ungu Lembut")
├── app.js          Kamera, panggil Gemini, keranjang, riwayat, anggaran
├── manifest.json   Bikin app bisa dipasang sebagai PWA
├── sw.js           Service worker — cache kerangka app biar buka cepat
├── icon.svg        Ikon vektor (favicon)
├── icon-192.png    Ikon PWA 192px
├── icon-512.png    Ikon PWA 512px
├── make-icons.py   Resep buat regenerasi dua PNG di atas
└── README.md       File ini
```

`make-icons.py` nggak ikut jalan di app — dia cuma generator yang dipakai sekali buat bikin `icon-192.png` & `icon-512.png`, jadi cuma perlu dijalanin lagi kalau mau ganti ikon. Sisanya (termasuk ikon, manifest, dan service worker) kepakai pas app jalan.

Model AI-nya diatur di konstanta `MODEL` paling atas `app.js`. Sekarang isinya `gemini-3.1-flash-lite`, dipaku ke id stabil (bukan alias `-latest`) karena jatah gratisnya paling longgar dan nggak ikut hot-swap ke rilis ber-limit lebih ketat.

## Privasi

Mode Demo mengirim foto label ke proxy Keranjang Pintar terlebih dulu agar API key demo tetap aman di server. Proxy hanya meneruskan gambar ke Google Gemini untuk membaca nama dan harga, tidak menyimpan foto. Kalau kamu memakai API key sendiri, key tetap disimpan di browsermu dan request berjalan langsung ke Google Gemini.
