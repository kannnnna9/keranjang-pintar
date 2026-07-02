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
  const calls = [];

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
              if (query.includes("SELECT count, last_request_at FROM daily_usage")) {
                return args[0] === "device"
                  ? { count: 1, last_request_at: 0 }
                  : { count: 2, last_request_at: 0 };
              }

              if (query.includes("SELECT value FROM runtime_state")) {
                return { value: "2" };
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
              calls.push({ query, args });
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
  assert.equal(calls.length, 6);
});
