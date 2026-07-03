# Demo Mode v2 Proxy Next Steps Checklist

Checklist pendek ini diasumsikan dijalankan di laptop/desktop/VM yang mendukung `workerd`.

## Persiapan

1. Buka worktree:
   - `/data/data/com.termux/files/home/claude-setup/projects/keranjang-pintar/.worktrees/demo-mode-v2-proxy`
2. Baca:
   - `docs/superpowers/specs/2026-07-02-demo-mode-v2-transfer-index.md`
   - `docs/superpowers/specs/2026-07-02-demo-mode-v2-proxy-handoff.md`
3. Cek status git:
   - `git status --short`

## Verifikasi Lokal Ulang

4. Masuk ke folder worker:
   - `cd worker`
5. Install dependency:
   - `npm install`
6. Jalankan test:
   - `npm test`

## Cloudflare

7. Pastikan sudah login / punya kredensial Cloudflare yang benar.
8. Migrasikan D1 lokal:
   - `npx wrangler d1 migrations apply keranjang_pintar_demo --local`
9. Set secret:
   - `npx wrangler secret put GEMINI_KEY_1`
   - `npx wrangler secret put GEMINI_KEY_2`
   - `npx wrangler secret put GEMINI_KEY_3`
   - `npx wrangler secret put HASH_SALT`
10. Jalankan Worker dev:
   - `npm run dev`
11. Migrasikan D1 remote:
   - `npx wrangler d1 migrations apply keranjang_pintar_demo --remote`
12. Deploy Worker:
   - `npm run deploy`

## Smoke Test

13. Dari root repo jalankan static server:
   - `python3 -m http.server 8000`
14. Buka app dan verifikasi:
   - BYOK masih direct ke Google
   - Demo memanggil Worker, bukan Google langsung dari browser
   - hasil scan tampil benar
   - cooldown 5 detik bekerja
   - fallback quota bekerja
   - cart/history aman saat ganti mode

## Release Flip

15. Isi URL Worker nyata ke `app.js`
16. Ubah `DEMO_AVAILABLE = true`
17. Jalankan final checks:
   - `node --check app.js`
   - `node --check sw.js`
   - `npm --prefix worker test`
   - `rg -n "AIza|AQ\\.|GEMINI_KEY_[123]\\s*=|sk-" .`
18. Commit perubahan release flip dan deploy-ready state.

## Jangan Lakukan

- Jangan commit secret.
- Jangan aktifkan Demo sebelum URL Worker nyata sudah ada.
- Jangan menghapus BYOK direct path.
