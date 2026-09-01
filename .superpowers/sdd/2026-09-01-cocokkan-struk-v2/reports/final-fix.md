# Final fix v2.8.0

Tanggal: 2026-09-01

## Perbaikan

1. `tambahDariStruk` sekarang membawa `urut` internal (non-enumerable, sehingga bentuk hasil publik tidak berubah) pada setiap baris asing. Setelah item ditambahkan, hanya baris transkripsi dengan `urut` tersebut yang diberi `cocokKe` indeks grup yang memuat baris keranjang baru. Hasil direkonsiliasi lokal tanpa panggilan AI. Ini mencegah klik berurutan menambahkan item yang sama dua kali.
2. Bila `rcJangkar` gagal (`cocok: false`), `reconcileHitung` memakai `hitungJS` sebagai `totalStruk` dan dasar `selisih`; jangkar tercetak yang tidak tervalidasi tetap hanya menjadi data pemeriksaan.
3. `manualMatch` lama tidak lagi menghasilkan status `beda`; ia mengikuti status v2 arah-kompatibel `lebih_mahal` atau `lebih_murah`.

## Regresi yang ditambahkan

- Jangkar gagal: total tercetak 25.000 dan hitung JS 10.000 menghasilkan `totalStruk` 10.000 dan `selisih` 0.
- Tambahkan dari struk dengan `reconcileHitung` nyata: baris asing diikat ke grup baru, status menjadi `sama`, asing kosong, dan klik kedua tidak menambah keranjang.
- Dua baris asing dengan nama serta qty sama: hanya baris yang dipilih yang diberi `cocokKe`; saudara kembarnya tetap asing.
- Manual match legacy: harga 120 vs 100 menghasilkan `lebih_mahal`.

## Verifikasi

- `node --check app.js`: lulus.
- `node --test test/reconcile.test.js test/manual-match.test.js`: 49 lulus, 0 gagal.
- `node --test "test/*.test.js"`: 96 lulus, 0 gagal.
- `git diff --check`: bersih.

## Final fix round 2

Review akhir menemukan bahwa `urut` berasal dari model dan tidak unik. Identitas internal baris asing diganti menjadi indeks sumber array hasil sanitasi (dibuat JS). Identitas ini non-enumerable, sehingga tidak mengubah schema AI, UI, snapshot, atau hasil serialisasi publik.

Regresi mempergunakan dua baris asing yang nama, qty, nominal, dan `urut: 1`-nya identik. Memilih baris kedua hanya mengubah `cocokKe` pada indeks sumber kedua; baris pertama tetap asing dan item keranjang baru berstatus `sama`.

Verifikasi round 2:

- `node --check app.js`: lulus.
- `node --test test/manual-match.test.js`: 5 lulus, 0 gagal.
