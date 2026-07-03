# Spec: Keranjang Pintar Demo Mode v2 Proxy

**Tanggal:** 2026-07-02  
**Status:** Approved design — ready for implementation planning  
**Scope:** Replace the unsafe v2.0 client-side demo-key design with a serverless proxy design.

---

## Capability

Keranjang Pintar can offer a public Demo Mode that lets new users scan price labels without bringing their own Gemini API key, while keeping all demo keys out of the browser and source repository. The demo is intentionally fair-use, not unlimited: usage is limited per device and per IP, the three demo keys are rotated server-side, failed keys are quarantined, and BYOK remains the durable path when demo quota is exhausted.

## Background

Version 2.0.0 implemented Demo Mode with three Gemini API keys in `app.js`. Version 2.0.1 disabled Demo Mode because Google automatically revoked those keys after they appeared in the public repository. The core lesson is now fixed policy: no provider secret may be placed in static client code. Demo Mode can only return after demo keys live as server-side secrets.

The existing app is a static vanilla JS PWA. BYOK already works by storing the user's Gemini key in browser `localStorage` and calling Gemini directly. That BYOK path must stay unchanged except for UI coexistence with the restored Demo Mode.

## Fixed Decisions

- Demo provider: Google Gemini using the current app model, `gemini-3.1-flash-lite`.
- Demo key pool: exactly three Gemini API keys from three different Google accounts/projects.
- Demo proxy: Cloudflare Worker.
- Persistent server state: Cloudflare D1.
- Device identity: random browser-generated ID stored in `localStorage` as `kp_demo_device_id`.
- IP identity: server-side IP hash derived in the Worker; raw IP is never stored.
- Device limit: 50 successful demo scans per device per day.
- IP limit: 150 successful demo scans per IP per day.
- Cooldown: 5 seconds per device, enforced by the proxy and mirrored in the client UI.
- Pool behavior: keep Demo Mode alive until all three demo keys are exhausted, rate-limited, or unhealthy.
- Failure fallback: if demo is unavailable, the app offers Input Manual and BYOK.

## Non-Goals

- No user accounts or login.
- No billing or paid plan.
- No image storage.
- No proxying BYOK requests.
- No guarantee against botnet-scale abuse.
- No dashboard for non-technical users in the first implementation.

## Architecture

```
Browser PWA
  - mode selection
  - camera/image compression
  - random device ID
  - BYOK direct Gemini call
  - Demo proxy call

Cloudflare Worker
  - CORS allowlist
  - request validation
  - IP/device hashing
  - quota/cooldown enforcement
  - server-side key rotation
  - Gemini API call
  - safe response/error envelope

Cloudflare D1
  - daily usage counters
  - demo key health
  - runtime round-robin cursor
  - optional redacted scan events
```

## Frontend Contract

The static app keeps two modes:

- `own_key`: current BYOK path; calls Gemini directly with `bco_api_key`.
- `demo`: sends the cropped JPEG base64 payload to the Worker.

Client constants:

```javascript
const DEMO_AVAILABLE = true;
const DEMO_PROXY_URL = 'https://keranjang-pintar-demo.<cloudflare-subdomain>.workers.dev/v1/demo/scan';
const DEMO_DEVICE_KEY = 'kp_demo_device_id';
const DEMO_DAILY_LIMIT = 50;
const DEMO_IP_DAILY_LIMIT = 150;
const DEMO_COOLDOWN_MS = 5000;
```

Client behavior:

- Generate `kp_demo_device_id` once with `crypto.randomUUID()` when possible.
- Never store or know any demo Gemini key.
- Treat proxy quota response as source of truth.
- Keep local quota/cooldown state only as a UI cache and preflight guard.
- Continue showing the existing soft failure sheet: Input Manual and Pakai Key Sendiri.
- Hide Demo entry points if `DEMO_AVAILABLE` is false or `DEMO_PROXY_URL` is empty.
- Update footer copy from `tanpa backend` to reflect that Demo uses a proxy while BYOK remains local.

## Worker API

### `POST /v1/demo/scan`

Request:

```json
{
  "deviceId": "random-client-id",
  "imageBase64": "jpeg-base64"
}
```

Success:

```json
{
  "ok": true,
  "data": {
    "nama": "Susu UHT",
    "harga": 18500
  },
  "quota": {
    "deviceUsed": 12,
    "deviceLimit": 50,
    "ipUsed": 31,
    "ipLimit": 150,
    "cooldownSeconds": 5
  }
}
```

Error:

```json
{
  "ok": false,
  "code": "DEMO_QUOTA_DEVICE",
  "message": "Kuota demo habis hari ini. Coba lagi besok atau pakai API key sendiri.",
  "quota": {
    "deviceUsed": 50,
    "deviceLimit": 50,
    "ipUsed": 73,
    "ipLimit": 150,
    "cooldownSeconds": 0
  }
}
```

Error codes:

- `BAD_REQUEST`: invalid JSON, missing fields, invalid base64, or payload too large.
- `ORIGIN_DENIED`: request origin is not allowed.
- `DEMO_COOLDOWN`: the device is still inside the 5 second cooldown.
- `DEMO_QUOTA_DEVICE`: device daily successful scan limit reached.
- `DEMO_QUOTA_IP`: IP daily successful scan limit reached.
- `DEMO_EXHAUSTED`: every demo key is unavailable or rate-limited.
- `GEMINI_UNAVAILABLE`: upstream transient failure after allowed retries.

## D1 Schema

```sql
CREATE TABLE daily_usage (
  scope TEXT NOT NULL,
  hash TEXT NOT NULL,
  date TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  last_request_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, hash, date)
);

CREATE TABLE demo_keys (
  slot INTEGER PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'healthy',
  cooldown_until INTEGER NOT NULL DEFAULT 0,
  fail_count INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE runtime_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE scan_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  device_hash TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  key_slot INTEGER,
  outcome TEXT NOT NULL,
  error_code TEXT
);
```

Only hashes are stored for device and IP. Images, API keys, raw IPs, raw device IDs, and full Gemini error bodies are not stored.

## Key Rotation And Health

The Worker stores the three Gemini keys as secrets:

- `GEMINI_KEY_1`
- `GEMINI_KEY_2`
- `GEMINI_KEY_3`

Rotation algorithm:

1. Load `rr_cursor` from `runtime_state`.
2. Select the next key slot with `status = healthy` and `cooldown_until <= now`.
3. Try at most one full pass over the three slots.
4. On Gemini success, advance `rr_cursor`, record success, and return parsed result.
5. On `429`, set temporary cooldown for that slot and try the next key.
6. On `401` or `403`, set status to `disabled` and try the next key.
7. On `5xx` or network timeout, increment fail count and try the next key once.
8. If no key succeeds, return `DEMO_EXHAUSTED` or `GEMINI_UNAVAILABLE`.

Manual recovery can be handled initially by D1 edits or a token-protected admin endpoint. A public admin UI is out of scope.

## Quota Rules

Date boundaries use UTC unless the Worker is explicitly configured otherwise. This avoids ambiguous local-time behavior at the edge.

Request lifecycle:

1. Validate request and origin.
2. Hash device ID and IP.
3. Read today's device and IP usage rows.
4. Reject if the device exceeded 50 successful scans.
5. Reject if the IP exceeded 150 successful scans.
6. Reject if `now - last_request_at < 5s` for the device.
7. Update device `last_request_at` before calling Gemini to stop request spamming.
8. Call Gemini via server-side key rotation.
9. Increment device and IP `count` only after a successful Gemini parse.

## Security Requirements

- No hardcoded provider keys in client, Worker source, docs, logs, tests, or commits.
- Worker secrets are configured only through Cloudflare secret storage.
- CORS allows the production GitHub Pages origin and localhost development origins only.
- Requests must use `POST` and `Content-Type: application/json`.
- `imageBase64` must be bounded by size before decoding or forwarding.
- The Worker returns generic user-safe messages and never forwards raw Gemini error details to the browser.
- Logs and `scan_events` must redact all secrets and avoid image content.
- SQL access must use parameterized D1 statements.
- Optional admin endpoint must require `ADMIN_TOKEN` and must not reveal secret values.

## Rollout

1. Add Worker project and D1 schema without touching production Demo UI.
2. Deploy Worker to a staging URL with non-production Gemini keys or mocked upstream responses.
3. Add frontend proxy integration behind `DEMO_AVAILABLE` and `DEMO_PROXY_URL`.
4. Test local BYOK regression, local demo success, quota errors, cooldown, and all-keys-exhausted behavior.
5. Configure three real Gemini secrets from three different Google accounts/projects.
6. Flip `DEMO_AVAILABLE` on for production.
7. Update README and CHANGELOG for `v2.1.0`, because this release adds a serverless service boundary to the static app.

## Testing Requirements

Worker unit tests:

- request validation rejects missing/oversized payloads.
- CORS rejects unknown origins.
- device limit rejects after 50 successes.
- IP limit rejects after 150 successes.
- cooldown rejects within 5 seconds.
- success increments counters only after valid Gemini result.
- 429 skips to the next key.
- 401/403 disables a key.
- all keys unavailable returns soft demo-exhausted error.

Frontend checks:

- BYOK still calls Gemini directly.
- Demo calls proxy and never calls Gemini directly.
- Demo unavailable hides demo entry points.
- Quota badge renders proxy quota values.
- Demo errors open the existing soft fallback sheet.

Manual smoke tests:

- new user can choose Demo and scan.
- existing BYOK user skips onboarding and still lands in dashboard.
- switching from Demo to BYOK preserves cart and history.
- service worker cache bump serves updated assets.

## Implementation Decisions Still Needed During Build

- Final production Worker hostname: use the default Workers route first, then replace it with a custom domain only if deployment needs it.
- Release version: use `v2.1.0`.
- Admin controls: first implementation manages key reset manually through D1. A token-protected admin endpoint is deferred until operational pain justifies it.

## Handoff

This capability is ready for implementation planning. The plan should produce a Cloudflare Worker plus frontend integration, keep BYOK untouched, and verify security boundaries before enabling Demo Mode in production.
