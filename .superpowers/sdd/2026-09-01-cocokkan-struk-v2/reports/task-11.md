# Task 11 — Retensi foto untuk status baru

## Hasil

- `mapMatchStatus` kini memetakan status v2.8.0:
  - `sama` → `matched_same`
  - `lebih_mahal`, `lebih_murah`, `qty_beda` → `matched_diff`
  - `tak_ketemu`, `tak_pasti`, status tak dikenal → `pending`
- Kategori retensi tetap empat nilai yang ada: `pending`, `matched_same`, `matched_diff`, `evidence`.
- Test lama untuk status `beda` diganti dengan coverage tujuh status v2.

## Verifikasi

- RED: `node --test "test/*.test.js"` menghasilkan 92 pass, 1 fail pada `lebih_mahal`.
- GREEN: `node --test "test/*.test.js"` menghasilkan 93 pass, 0 fail.

