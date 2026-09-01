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
