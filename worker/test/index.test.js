import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.js";

test("/health returns ok", async () => {
  const response = await worker.fetch(new Request("https://example.com/health"));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test("unknown routes return 404", async () => {
  const response = await worker.fetch(new Request("https://example.com/missing"));

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    ok: false,
    code: "NOT_FOUND",
    message: "Not found.",
  });
});

test("demo scan route proxies successful scans through quota and rotation helpers", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  const writes = [];

  t.after(() => {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
  });

  Date.now = () => Date.parse("2026-07-02T00:00:00.000Z");
  globalThis.fetch = async () => Response.json({
    candidates: [
      {
        content: {
          parts: [{ text: "{\"nama\":\"Susu\",\"harga\":18500}" }],
        },
      },
    ],
  });

  const db = {
    prepare(query) {
      return {
        bind(...args) {
          return {
            async first() {
              if (query.includes("SELECT value FROM runtime_state")) {
                return { value: "2" };
              }

              if (query.includes("WITH existing") && args[0] === "device") {
                return {
                  count: 2,
                  last_request_at: Math.floor(Date.parse("2026-07-02T00:00:00.000Z") / 1000),
                  claimed: 1,
                  previous_count: 1,
                  previous_last_request_at: 0,
                };
              }

              if (query.includes("WITH existing") && args[0] === "ip") {
                return {
                  count: 3,
                  last_request_at: Math.floor(Date.parse("2026-07-02T00:00:00.000Z") / 1000),
                  claimed: 1,
                  previous_count: 2,
                  previous_last_request_at: 0,
                };
              }

              return undefined;
            },
            async all() {
              if (query.includes("SELECT slot FROM demo_keys")) {
                return { results: [{ slot: 2 }, { slot: 3 }] };
              }

              return { results: [] };
            },
            async run() {
              writes.push({ query, args });
            },
          };
        },
      };
    },
  };

  const response = await worker.fetch(
    new Request("https://example.com/v1/demo/scan", {
      method: "POST",
      headers: {
        origin: "https://kannnnna9.github.io",
        "content-type": "application/json",
        "cf-connecting-ip": "203.0.113.8",
      },
      body: JSON.stringify({
        deviceId: "device-123",
        imageBase64: "aGVsbG8=",
      }),
    }),
    {
      ALLOWED_ORIGINS: "https://kannnnna9.github.io",
      DEVICE_DAILY_LIMIT: "50",
      IP_DAILY_LIMIT: "150",
      DEVICE_COOLDOWN_SECONDS: "5",
      GEMINI_MODEL: "gemini-3.1-flash-lite",
      GEMINI_KEY_2: "demo-key-2",
      HASH_SALT: "salt",
      DB: db,
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    data: { nama: "Susu", harga: 18500 },
    quota: {
      deviceUsed: 2,
      deviceLimit: 50,
      ipUsed: 3,
      ipLimit: 150,
      cooldownSeconds: 5,
    },
  });
  assert.equal(writes.length, 3);
  assert.match(writes[0].query, /fail_count = 0/);
  assert.match(writes[1].query, /INSERT INTO runtime_state/);
  assert.match(writes[2].query, /INSERT INTO scan_events/);
});

test("demo scan returns quota denial without calling gemini", async (t) => {
  const originalFetch = globalThis.fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return Response.json({});
  };

  const db = {
    prepare(query) {
      return {
        bind(...args) {
          return {
            async first() {
              if (query.includes("WITH existing") && args[0] === "device") {
                return {
                  count: 50,
                  last_request_at: 0,
                  claimed: 0,
                  previous_count: 50,
                  previous_last_request_at: 0,
                };
              }

              if (query.includes("WITH existing") && args[0] === "ip") {
                throw new Error("ip claim should not run after device denial");
              }

              return undefined;
            },
            async all() {
              return { results: [] };
            },
            async run() {
              throw new Error("no writes expected after denial");
            },
          };
        },
      };
    },
  };

  const response = await worker.fetch(
    new Request("https://example.com/v1/demo/scan", {
      method: "POST",
      headers: {
        origin: "https://kannnnna9.github.io",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        deviceId: "device-123",
        imageBase64: "aGVsbG8=",
      }),
    }),
    {
      ALLOWED_ORIGINS: "https://kannnnna9.github.io",
      DEVICE_DAILY_LIMIT: "50",
      IP_DAILY_LIMIT: "150",
      DEVICE_COOLDOWN_SECONDS: "5",
      HASH_SALT: "salt",
      DB: db,
    },
  );

  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), {
    ok: false,
    code: "DEMO_QUOTA_DEVICE",
    message: "Kuota demo habis hari ini. Coba lagi besok atau pakai API key sendiri.",
    quota: {
      deviceUsed: 50,
      deviceLimit: 50,
      ipUsed: 0,
      ipLimit: 150,
      cooldownSeconds: 0,
    },
  });
  assert.equal(fetchCalled, false);
});
