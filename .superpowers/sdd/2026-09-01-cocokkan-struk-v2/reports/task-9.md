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
