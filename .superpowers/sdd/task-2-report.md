# Task 2 Report: HTTP Envelope And Request Validation

## Status
Completed.

## What changed
- Added `worker/src/http.js` with:
  - `PublicError`
  - `corsHeaders(origin, env)`
  - `jsonOk(data, quota, init?)`
  - `jsonError(code, message, status, quota?)`
  - `parseDemoScanRequest(request)`
- Added `worker/test/http.test.js` covering:
  - allowed CORS origins
  - safe error envelope
  - required-field validation
  - valid bounded base64 payload parsing
- Updated `worker/src/index.js` to route:
  - `OPTIONS` preflight through the shared CORS helper
  - `/health` through `jsonOk`
  - unknown routes through `jsonError`

## Verification
- Ran `cd worker && npm test`
- Result: 6 tests passed, 0 failed

## Self-review
- Kept the change scoped to the owned worker files only.
- Preserved the existing `/health` response shape while still using the shared helper.
- Made `corsHeaders` null-safe so tests and worker execution both work when `env` is absent.

## Concerns
- None.

## Fix Follow-up
- Added an object/null guard in `worker/src/http.js` so valid JSON bodies like `null` cannot reach `body.deviceId`.
- Added a focused regression test in `worker/test/http.test.js` for `null` JSON bodies.

## Verification
- Ran `cd worker && npm test`
- Result: 7 tests passed, 0 failed
- Ran `node --check worker/src/index.js`
- Result: passed

---

## Fix Append

Addressed the reviewer note by adding a regression test for `null` JSON bodies in `worker/test/http.test.js`. The existing object/null guard in `worker/src/http.js` already prevents raw `TypeError` escapes.

### Verification

```bash
node --test /data/data/com.termux/files/home/claude-setup/projects/keranjang-pintar/.worktrees/demo-mode-v2-proxy/worker/test/http.test.js
node --check /data/data/com.termux/files/home/claude-setup/projects/keranjang-pintar/.worktrees/demo-mode-v2-proxy/worker/src/index.js
```

Observed result:

- `5` tests passed, `0` failed
- `node --check` passed with exit code `0`
