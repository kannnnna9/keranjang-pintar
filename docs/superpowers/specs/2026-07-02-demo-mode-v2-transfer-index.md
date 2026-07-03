# Demo Mode v2 Proxy Transfer Index

## Start Here

Jika tugas ini diteruskan ke orang atau AI lain, baca dokumen dalam urutan ini:

1. `docs/superpowers/specs/2026-07-02-demo-mode-v2-transfer-index.md`
2. `docs/superpowers/specs/2026-07-02-demo-mode-v2-proxy-handoff.md`
3. `docs/superpowers/specs/2026-07-02-demo-mode-v2-next-steps-checklist.md`
4. `docs/superpowers/plans/2026-07-02-demo-mode-v2-proxy.md`
5. `docs/superpowers/specs/2026-07-02-demo-mode-v2-proxy-design.md`

Dokumen lain di bawah hanya dibaca jika butuh detail implementasi atau audit.

## Konteks Kerja

- Repo/worktree aktif:
  - `/data/data/com.termux/files/home/claude-setup/projects/keranjang-pintar/.worktrees/demo-mode-v2-proxy`
- Branch:
  - `feat/demo-mode-v2-proxy`
- Commit HEAD terakhir yang sudah ada di git:
  - `e16318a fix: harden demo proxy release behavior`
- Ada perubahan lokal belum di-commit sesudah commit itu.

## Status Singkat

- Implementasi lokal untuk Task 1 sampai Task 9: selesai.
- Review akhir branch: sudah dilakukan.
- Temuan review akhir yang valid: sudah diperbaiki secara lokal.
- Task 10: belum selesai karena deploy Cloudflare Worker tidak bisa dijalankan di environment Termux Android ARM64 ini.

## Perubahan Lokal Yang Belum Di-commit

Perubahan lokal saat handoff ini dibuat:

- `README.md`
- `app.js`
- `worker/src/quota.js`
- `worker/test/index.test.js`
- `worker/test/quota.test.js`
- `.superpowers/sdd/progress.md`
- `docs/superpowers/specs/2026-07-02-demo-mode-v2-proxy-handoff.md`
- `docs/superpowers/specs/2026-07-02-demo-mode-v2-transfer-index.md`
- `docs/superpowers/specs/2026-07-02-demo-mode-v2-next-steps-checklist.md`

## Yang Paling Penting Untuk Dipahami

- Demo key tidak lagi boleh masuk browser atau repo.
- BYOK harus tetap direct browser ke Google Gemini.
- Demo mode sekarang dirancang lewat Cloudflare Worker + D1.
- `HASH_SALT` wajib ada.
- Jangan aktifkan `DEMO_AVAILABLE = true` sebelum Worker benar-benar terdeploy dan smoke test lolos.
- URL Worker final belum diisi karena deploy belum bisa dilakukan dari mesin ini.

## Bukti Verifikasi Yang Sudah Ada

Hasil lokal yang sudah lulus:

- `node --test worker/test/index.test.js`
  - `9/9 pass`
- `npm --prefix worker test`
  - `48/48 pass`
- `node --check app.js`
  - pass
- `node --check sw.js`
  - pass
- `rg -n "<cloudflare-subdomain>" .`
  - tidak ada hasil

## Kenapa Blocked

Environment saat ini adalah Termux Android ARM64. `wrangler` bergantung pada `workerd`, dan `workerd` gagal dengan:

- `Unsupported platform: android arm64 LE`

Blocker ini sudah diuji beberapa cara:

- `npm --prefix worker install`
  - gagal
- install probe `wrangler --ignore-scripts`
  - install berhasil
  - runtime `npx wrangler --version` tetap crash
  - runtime `npx wrangler d1 --help` tetap crash
- tidak ada kredensial `CF_*` / `CLOUDFLARE_*` aktif untuk jalur deploy alternatif

## Dokumen Yang Sudah Dirapikan

### Dokumen utama

- `docs/superpowers/specs/2026-07-02-demo-mode-v2-transfer-index.md`
  - indeks serah-terima ini
- `docs/superpowers/specs/2026-07-02-demo-mode-v2-proxy-handoff.md`
  - ringkasan status, blocker, dan langkah lanjut
- `docs/superpowers/specs/2026-07-02-demo-mode-v2-next-steps-checklist.md`
  - checklist eksekusi singkat saat pindah ke laptop/PC

### Dokumen desain dan rencana

- `docs/superpowers/specs/2026-07-02-demo-mode-v2-proxy-design.md`
  - desain yang disetujui
- `docs/superpowers/plans/2026-07-02-demo-mode-v2-proxy.md`
  - plan implementasi lengkap sampai Task 10

### Ledger dan audit

- `.superpowers/sdd/progress.md`
  - status Task 1..10
- `.superpowers/sdd/review-dadefa9..e16318a.diff`
  - paket review branch penuh paling relevan
- `.superpowers/sdd/review-dadefa9..b551d32.diff`
  - paket review sebelum hardening terakhir

### Laporan tugas

- `.superpowers/sdd/task-1-report.md`
- `.superpowers/sdd/task-2-report.md`
- `.superpowers/sdd/task-3-report.md`
- `.superpowers/sdd/task-4-report.md`
- `.superpowers/sdd/task-5-report.md`
- `.superpowers/sdd/task-6-report.md`
- `.superpowers/sdd/task-7-report.md`
- `.superpowers/sdd/task-8-report.md`
- `.superpowers/sdd/task-9-report.md`

## File Kode Yang Paling Relevan

- `worker/src/index.js`
- `worker/src/http.js`
- `worker/src/identity.js`
- `worker/src/quota.js`
- `worker/src/gemini.js`
- `worker/src/rotation.js`
- `worker/migrations/0001_demo_proxy.sql`
- `worker/wrangler.toml`
- `worker/test/index.test.js`
- `worker/test/quota.test.js`
- `app.js`
- `README.md`
- `CHANGELOG.md`

## Instruksi Untuk Penerus

- Jangan baca ulang seluruh chat jika tidak perlu.
- Mulai dari tiga dokumen utama di atas.
- Jika bekerja di mesin yang mendukung `workerd`, lanjutkan Task 10 dari checklist singkat.
- Jika hanya ingin audit implementasi lokal, fokus ke file kode utama dan hasil test.
