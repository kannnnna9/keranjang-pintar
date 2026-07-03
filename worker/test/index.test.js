import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.js";

const JPEG_BASE64 = "/9j/2w==";

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

              if (query.includes("SELECT count, last_request_at FROM daily_usage") && args[0] === "device") {
                return { count: 1, last_request_at: 0 };
              }

              if (query.includes("UPDATE daily_usage") && args[1] === "device") {
                return {
                  count: 2,
                  last_request_at: Math.floor(Date.parse("2026-07-02T00:00:00.000Z") / 1000),
                };
              }

              if (query.includes("SELECT count, last_request_at FROM daily_usage") && args[0] === "ip") {
                return { count: 2, last_request_at: 0 };
              }

              if (query.includes("UPDATE daily_usage") && args[1] === "ip") {
                return {
                  count: 3,
                  last_request_at: Math.floor(Date.parse("2026-07-02T00:00:00.000Z") / 1000),
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
        imageBase64: JPEG_BASE64,
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
  assert.equal(writes.length, 5);
  assert.match(writes[0].query, /INSERT OR IGNORE INTO daily_usage/);
  assert.match(writes[1].query, /INSERT OR IGNORE INTO daily_usage/);
  assert.match(writes[2].query, /fail_count = 0/);
  assert.match(writes[3].query, /INSERT INTO runtime_state/);
  assert.match(writes[4].query, /INSERT INTO scan_events/);
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
              if (query.includes("SELECT count, last_request_at FROM daily_usage") && args[0] === "device") {
                return { count: 50, last_request_at: 0 };
              }

              if (query.includes("UPDATE daily_usage") && args[1] === "device") {
                return undefined;
              }

              if (query.includes("SELECT count, last_request_at FROM daily_usage") && args[0] === "ip") {
                return { count: 7, last_request_at: 0 };
              }

              return undefined;
            },
            async all() {
              return { results: [] };
            },
            async run() {
              if (!query.includes("INSERT OR IGNORE INTO daily_usage")) {
                throw new Error("no writes expected after denial");
              }
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
        imageBase64: JPEG_BASE64,
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
      ipUsed: 7,
      ipLimit: 150,
      cooldownSeconds: 0,
    },
  });
  assert.equal(fetchCalled, false);
});

test("demo scan rejects requests without an allowed origin", async () => {
  const response = await worker.fetch(
    new Request("https://example.com/v1/demo/scan", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        deviceId: "device-123",
        imageBase64: JPEG_BASE64,
      }),
    }),
    {
      ALLOWED_ORIGINS: "https://kannnnna9.github.io",
      DB: {},
    },
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    ok: false,
    code: "ORIGIN_DENIED",
    message: "Origin tidak diizinkan.",
  });
});

test("demo scan rejects missing hash salt", async () => {
  const response = await worker.fetch(
    new Request("https://example.com/v1/demo/scan", {
      method: "POST",
      headers: {
        origin: "https://kannnnna9.github.io",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        deviceId: "device-123",
        imageBase64: JPEG_BASE64,
      }),
    }),
    {
      ALLOWED_ORIGINS: "https://kannnnna9.github.io",
      DB: {},
    },
  );

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    ok: false,
    code: "GEMINI_UNAVAILABLE",
    message: "Demo sedang tidak tersedia. Coba lagi nanti atau pakai API key sendiri.",
  });
});

test("demo scan releases claimed quota when gemini fails", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  const releases = [];

  t.after(() => {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
  });

  Date.now = () => Date.parse("2026-07-02T00:00:00.000Z");
  globalThis.fetch = async () => new Response("nope", { status: 503 });

  const db = {
    prepare(query) {
      return {
        bind(...args) {
          return {
            async first() {
              if (query.includes("SELECT count, last_request_at FROM daily_usage") && args[0] === "device") {
                return { count: 1, last_request_at: 0 };
              }

              if (query.includes("UPDATE daily_usage") && args[1] === "device") {
                return { count: 2, last_request_at: 100 };
              }

              if (query.includes("SELECT count, last_request_at FROM daily_usage") && args[0] === "ip") {
                return { count: 2, last_request_at: 0 };
              }

              if (query.includes("UPDATE daily_usage") && args[1] === "ip") {
                return { count: 3, last_request_at: 100 };
              }

              if (query.includes("SELECT value FROM runtime_state")) {
                return { value: "1" };
              }

              return undefined;
            },
            async all() {
              if (query.includes("SELECT slot FROM demo_keys")) {
                return { results: [{ slot: 1 }] };
              }

              return { results: [] };
            },
            async run() {
              if (query.includes("SET count = CASE WHEN count > 0 THEN count - 1 ELSE 0 END")) {
                releases.push(args);
              }
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
        imageBase64: JPEG_BASE64,
      }),
    }),
    {
      ALLOWED_ORIGINS: "https://kannnnna9.github.io",
      DEVICE_DAILY_LIMIT: "50",
      IP_DAILY_LIMIT: "150",
      DEVICE_COOLDOWN_SECONDS: "5",
      GEMINI_MODEL: "gemini-3.1-flash-lite",
      GEMINI_KEY_1: "demo-key-1",
      HASH_SALT: "salt",
      DB: db,
    },
  );

  assert.equal(response.status, 503);
  assert.equal(releases.length, 2);
  assert.deepEqual(releases[0], ["device", releases[0][1], "2026-07-02"]);
  assert.deepEqual(releases[1], ["ip", releases[1][1], "2026-07-02"]);
});

test("demo scan keeps rotating after a disabled key failure", async (t) => {
  const originalFetch = globalThis.fetch;
  const attempts = [];

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (url, init) => {
    attempts.push(init.headers["x-goog-api-key"]);
    if (init.headers["x-goog-api-key"] === "bad-key") {
      return new Response("denied", { status: 403 });
    }

    return Response.json({
      candidates: [
        {
          content: {
            parts: [{ text: "{\"nama\":\"Susu\",\"harga\":18500}" }],
          },
        },
      ],
    });
  };

  const db = {
    prepare(query) {
      return {
        bind(...args) {
          return {
            async first() {
              if (query.includes("SELECT count, last_request_at FROM daily_usage") && args[0] === "device") {
                return { count: 0, last_request_at: 0 };
              }

              if (query.includes("UPDATE daily_usage") && args[1] === "device") {
                return { count: 1, last_request_at: 100 };
              }

              if (query.includes("SELECT count, last_request_at FROM daily_usage") && args[0] === "ip") {
                return { count: 0, last_request_at: 0 };
              }

              if (query.includes("UPDATE daily_usage") && args[1] === "ip") {
                return { count: 1, last_request_at: 100 };
              }

              if (query.includes("SELECT value FROM runtime_state")) {
                return { value: "1" };
              }

              return undefined;
            },
            async all() {
              if (query.includes("SELECT slot FROM demo_keys")) {
                return { results: [{ slot: 1 }, { slot: 2 }] };
              }

              return { results: [] };
            },
            async run() {},
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
        imageBase64: JPEG_BASE64,
      }),
    }),
    {
      ALLOWED_ORIGINS: "https://kannnnna9.github.io",
      DEVICE_DAILY_LIMIT: "50",
      IP_DAILY_LIMIT: "150",
      DEVICE_COOLDOWN_SECONDS: "5",
      GEMINI_MODEL: "gemini-3.1-flash-lite",
      GEMINI_KEY_1: "bad-key",
      GEMINI_KEY_2: "good-key",
      HASH_SALT: "salt",
      DB: db,
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(attempts, ["bad-key", "good-key"]);
});

test("demo scan stops on permanent upstream errors", async (t) => {
  const originalFetch = globalThis.fetch;
  const attempts = [];

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (url, init) => {
    attempts.push(init.headers["x-goog-api-key"]);
    return new Response("bad request", { status: 400 });
  };

  const db = {
    prepare(query) {
      return {
        bind(...args) {
          return {
            async first() {
              if (query.includes("SELECT count, last_request_at FROM daily_usage") && args[0] === "device") {
                return { count: 0, last_request_at: 0 };
              }

              if (query.includes("UPDATE daily_usage") && args[1] === "device") {
                return { count: 1, last_request_at: 100 };
              }

              if (query.includes("SELECT count, last_request_at FROM daily_usage") && args[0] === "ip") {
                return { count: 0, last_request_at: 0 };
              }

              if (query.includes("UPDATE daily_usage") && args[1] === "ip") {
                return { count: 1, last_request_at: 100 };
              }

              if (query.includes("SELECT value FROM runtime_state")) {
                return { value: "1" };
              }

              return undefined;
            },
            async all() {
              if (query.includes("SELECT slot FROM demo_keys")) {
                return { results: [{ slot: 1 }, { slot: 2 }] };
              }

              return { results: [] };
            },
            async run() {},
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
        imageBase64: JPEG_BASE64,
      }),
    }),
    {
      ALLOWED_ORIGINS: "https://kannnnna9.github.io",
      DEVICE_DAILY_LIMIT: "50",
      IP_DAILY_LIMIT: "150",
      DEVICE_COOLDOWN_SECONDS: "5",
      GEMINI_MODEL: "gemini-3.1-flash-lite",
      GEMINI_KEY_1: "bad-key",
      GEMINI_KEY_2: "good-key",
      HASH_SALT: "salt",
      DB: db,
    },
  );

  assert.equal(response.status, 503);
  assert.deepEqual(attempts, ["bad-key"]);
});
