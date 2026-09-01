# Task 9 — Tombol Tambahkan

## Implementasi

- Menambahkan `tambahDariStruk(idx)` di `app.js` dekat `manualMatch`.
  Fungsi mengambil baris `asing` dari hasil rekonsiliasi yang sudah ada,
  menambahkannya ke keranjang dengan `dariStruk: true`, lalu menghitung ulang
  memakai `reconcileHitung(lastGrup, lastBaris)`. Tidak ada pemanggilan Gemini.
- Menambahkan `perbaruiEntriRiwayat()` untuk mengganti `items` dan `total` pada
  entri riwayat dengan `sessionId` yang sama; waktu dan identitas sesi tetap.
- Menambahkan badge `Dari struk` sebelum badge promo reguler.

## Regresi

- `test/manual-match.test.js` mendapat satu tes tindakan nyata karena harness
  VM yang sama sudah memuat fungsi di sekitar `manualMatch`. Tes memverifikasi
  item baru, hitung ulang lokal, pembaruan entri riwayat yang sama, dan toast.
  Lingkup ini sengaja tidak diperluas ke test baru karena kontrak lainnya sudah
  dicakup oleh unit RECONCILE RULES.
- RED teramati: tes gagal dengan `ReferenceError: tambahDariStruk is not defined`.
- GREEN: `node --test test/manual-match.test.js` lulus 2/2.

## Verifikasi

- `node --check app.js` — lulus.
- `node --test "test/*.test.js"` — lulus: 90 pass, 0 fail.
- `git diff --check` — lulus.

## Fix round 1/5 — klik ganda saat pembaruan foto berjalan

- Akar masalah: kedua pemanggilan dapat membaca `lastReconcile.asing[idx]`
  yang sama sebelum pemanggilan pertama melewati `await applyReconcileResult`.
- `tambahDariStruk` kini memakai satu guard bersama sebelum mutasi dan
  melepaskannya dalam `finally`, termasuk ketika pembaruan gagal.
- Tes serentak baru mula-mula RED (`2 !== 1`), lalu GREEN; suite penuh lulus
  91 pass, 0 fail.

## Follow-up ceiling guard

- Guard global diberi komentar `ponytail:`: ia sengaja menserialkan semua aksi
  Tambahkan karena state keranjang, riwayat, dan sesi dipakai bersama. Naikkan
  menjadi guard per-item hanya jika UI perlu menerima beberapa item serentak.
