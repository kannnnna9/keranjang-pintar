# Demo Mode v2 Proxy Handoff

## Ringkasan Singkat

- Status implementasi lokal: selesai dan terverifikasi.
- Status deploy/verifikasi Cloudflare: belum selesai karena environment Termux Android ARM64 ini tidak mendukung `workerd`, sehingga `wrangler` tidak bisa dijalankan.
- Goal sesi ditandai blocked karena sisa pekerjaan membutuhkan external-state change: mesin lain yang mendukung `workerd` atau jalur deploy lain dengan kredensial yang valid.

## Yang Sudah Selesai

- Worker proxy untuk `POST /v1/demo/scan` sudah dibuat.
- Validasi request demo, origin allowlist, hash identifier, quota device/IP, cooldown, dan rotasi key server-side sudah diimplementasikan.
- Frontend demo mode sudah diarahkan ke proxy, sementara BYOK tetap langsung ke Google Gemini.
- `HASH_SALT` sekarang wajib ada.
- Rotasi key sekarang:
  - lanjut ke key berikutnya jika key gagal karena disabled/auth issue yang memang spesifik key
  - berhenti jika upstream mengembalikan request-level permanent error
- Review akhir branch menghasilkan temuan tambahan, dan semuanya sudah diperbaiki secara lokal:
  - placeholder URL Worker di frontend dihapus dari state release-disabled
  - edge case rollback quota IP diperbaiki
  - wording README disesuaikan agar tidak mengklaim Demo sudah live

## Perubahan Lokal Yang Belum Di-commit

Masih ada perubahan lokal yang sengaja belum di-commit:

- `README.md`
- `app.js`
- `worker/src/quota.js`
- `worker/test/index.test.js`
- `worker/test/quota.test.js`
- `.superpowers/sdd/progress.md`

Perubahan ini sudah diverifikasi, tetapi belum dibuat commit baru karena aturan sesi aktif saat akhir pekerjaan melarang auto-commit tanpa permintaan eksplisit.

## Bukti Verifikasi Lokal

Command yang terakhir lulus:

- `node --test worker/test/index.test.js`
  - hasil: 9/9 pass
- `npm --prefix worker test`
  - hasil: 48/48 pass
- `node --check app.js`
  - pass
- `node --check sw.js`
  - pass
- `rg -n "<cloudflare-subdomain>" .`
  - tidak ada hasil
- `rg -n "AIza|AQ\\.|GEMINI_KEY_[123]\\s*=|sk-" .`
  - hanya menemukan mention format key di dokumentasi/kode komentar, tidak ada secret nyata

## Kenapa Task 10 Masih Blocked

Task 10 memerlukan `wrangler` untuk:

- `wrangler d1 migrations apply --local`
- `wrangler secret put ...`
- `wrangler dev`
- `wrangler d1 migrations apply --remote`
- `wrangler deploy`

Bukti blocker yang sudah diuji:

- `npm --prefix worker install` gagal dengan error:
  - `Unsupported platform: android arm64 LE`
- Install probe dengan `npm install wrangler@4.106.0 --ignore-scripts` memang berhasil di sandbox, tetapi:
  - `npx wrangler --version` tetap crash
  - `npx wrangler d1 --help` tetap crash
- Metadata paket `wrangler` menunjukkan `workerd` adalah dependency langsung, bukan optional dependency.
- Tidak ada env aktif `CF_*` atau `CLOUDFLARE_*`.
- Tidak ditemukan token Cloudflare nyata di scope aman yang bisa dipakai untuk deploy langsung via API.

Kesimpulan: blocker ini bukan asumsi. Dari environment ini, deploy Worker memang tidak bisa diselesaikan.

## Langkah Berikutnya Di Mesin Yang Benar

Lanjutkan dari worktree/branch yang sama di laptop, desktop, VM, atau environment Linux/macOS yang didukung `workerd`.

Urutan kerja:

1. Pastikan worktree ini dibuka:
   - `/data/data/com.termux/files/home/claude-setup/projects/keranjang-pintar/.worktrees/demo-mode-v2-proxy`
2. Cek perubahan lokal:
   - `git status --short`
3. Install dependency worker:
   - `cd worker`
   - `npm install`
4. Jalankan test lagi:
   - `npm test`
5. Buat/migrasikan D1:
   - `npx wrangler d1 migrations apply keranjang_pintar_demo --local`
   - `npx wrangler d1 migrations apply keranjang_pintar_demo --remote`
6. Set secret Worker:
   - `npx wrangler secret put GEMINI_KEY_1`
   - `npx wrangler secret put GEMINI_KEY_2`
   - `npx wrangler secret put GEMINI_KEY_3`
   - `npx wrangler secret put HASH_SALT`
7. Jalankan Worker dev:
   - `npm run dev`
8. Jalankan static app:
   - dari root repo: `python3 -m http.server 8000`
9. Lakukan smoke test browser sesuai checklist Task 10.
10. Setelah Worker URL nyata sudah ada dan smoke test lolos:
   - isi URL Worker nyata ke `app.js`
   - ubah `DEMO_AVAILABLE = true`
11. Jalankan grep security final lagi.
12. Baru setelah itu buat commit release flip.

## File Yang Perlu Dicek Saat Lanjut

File implementasi utama:

- `worker/src/index.js`
- `worker/src/quota.js`
- `worker/src/rotation.js`
- `worker/src/gemini.js`
- `worker/src/identity.js`
- `app.js`
- `README.md`
- `CHANGELOG.md`
- `worker/wrangler.toml`
- `worker/migrations/0001_demo_proxy.sql`

File test utama:

- `worker/test/index.test.js`
- `worker/test/quota.test.js`

## Indeks Dokumentasi Sebelumnya

### Plan utama

- `docs/superpowers/plans/2026-07-02-demo-mode-v2-proxy.md`

### Progress ledger

- `.superpowers/sdd/progress.md`

### Report per tugas

- `.superpowers/sdd/task-1-report.md`
- `.superpowers/sdd/task-2-report.md`
- `.superpowers/sdd/task-3-report.md`
- `.superpowers/sdd/task-4-report.md`
- `.superpowers/sdd/task-5-report.md`
- `.superpowers/sdd/task-6-report.md`
- `.superpowers/sdd/task-7-report.md`
- `.superpowers/sdd/task-8-report.md`
- `.superpowers/sdd/task-9-report.md`

### Brief per tugas

- `.superpowers/sdd/task-1-brief.md`
- `.superpowers/sdd/task-2-brief.md`
- `.superpowers/sdd/task-3-brief.md`
- `.superpowers/sdd/task-4-brief.md`
- `.superpowers/sdd/task-5-brief.md`
- `.superpowers/sdd/task-6-brief.md`
- `.superpowers/sdd/task-7-brief.md`

### Paket review yang paling relevan

- `.superpowers/sdd/review-dadefa9..e16318a.diff`
  - paket review cabang penuh sebelum fix lokal terakhir yang belum di-commit
- `.superpowers/sdd/review-dadefa9..b551d32.diff`
  - paket review cabang penuh sebelum hardening terakhir

## Catatan Praktis

- Jangan flip `DEMO_AVAILABLE` ke `true` sebelum URL Worker nyata sudah ada dan smoke test selesai.
- Jangan commit secret apa pun.
- Jika nanti sesi baru dibuka di mesin yang didukung, dokumen ini harus menjadi titik masuk utama, bukan membaca ulang seluruh chat.
