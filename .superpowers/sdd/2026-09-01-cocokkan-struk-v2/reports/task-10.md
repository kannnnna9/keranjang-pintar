# Task 10 — Snapshot v2 + kompatibilitas v1 + riwayat per kelompok

## TDD

- RED: `node --test "test/*.test.js"` menghasilkan 91 test: 87 lulus, 4 gagal. Keempatnya adalah kontrak snapshot v2 baru yang belum ada pada format v1.
- GREEN: perintah yang sama menghasilkan 91 lulus, 0 gagal.

## Implementasi

- `saveReconcileToHistory` kini menyimpan hasil rekonsiliasi lengkap melalui snapshot v2.
- Snapshot menyimpan angka total, jangkar, ringkasan baris beserta unit, dan baris struk asing.
- Riwayat snapshot v1 tetap dirender apa adanya dengan label format lama; v2 merangkum hasil menurut kelompok tindakan.
- Menambahkan gaya minimal untuk tiap baris kelompok riwayat.

## Verifikasi

- `node --check app.js` lulus.
- `git diff --check` bersih.
- Tidak mengubah worker, PROMO RULES, alur scan, atau Demo.

## Fix round 1/5 — nama OCR di panel riwayat

- Akar masalah: renderer snapshot v2 memasukkan `rc.rows[].nama` dan `rc.asing[].nama` langsung ke `innerHTML`. Nama berasal dari OCR/riwayat, sehingga tag seperti `<img onerror=...>` akan diparse sebagai elemen saat riwayat dibuka.
- Perbaikan minimum: `teksAman` meng-escape lima karakter HTML pada dua interpolasi nama tersebut. Jalur v1 tidak merender nama; daftar item riwayat yang lain sudah menetapkan nama lewat `textContent`.
- Regresi menjalankan `showHistoryDetail` dengan dua nama `<img ...>` dan memastikan panel tidak memiliki elemen `img`, sekaligus mencakup `saveReconcileToHistory` ke snapshot v2 sesi aktif.
- Focused `node --test test/reconcile-snapshot.test.js`: 6 lulus, 0 gagal. Full `node --test "test/*.test.js"`: 93 lulus, 0 gagal. `node --check app.js` dan `git diff --check` lulus.
