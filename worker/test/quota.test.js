import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  claimQuota,
  decideQuota,
  incrementUsage,
  loadUsage,
  quotaSnapshot,
  releaseQuota,
  touchCooldown,
} from "../src/quota.js";

const limits = {
  deviceDailyLimit: 50,
  ipDailyLimit: 150,
  cooldownSeconds: 5,
};

test("quotaSnapshot maps usage and limits", () => {
  assert.deepEqual(
    quotaSnapshot({ count: 2 }, { count: 7 }, limits, 3),
    {
      deviceUsed: 2,
      deviceLimit: 50,
      ipUsed: 7,
      ipLimit: 150,
      cooldownSeconds: 3,
    },
  );
});

test("decideQuota rejects device daily limit", () => {
  const result = decideQuota({
    deviceRow: { count: 50, last_request_at: 0 },
    ipRow: { count: 10, last_request_at: 0 },
    now: 100,
    limits,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "DEMO_QUOTA_DEVICE");
});

test("decideQuota rejects IP daily limit", () => {
  const result = decideQuota({
    deviceRow: { count: 1, last_request_at: 0 },
    ipRow: { count: 150, last_request_at: 0 },
    now: 100,
    limits,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "DEMO_QUOTA_IP");
});

test("decideQuota rejects active cooldown", () => {
  const result = decideQuota({
    deviceRow: { count: 1, last_request_at: 98 },
    ipRow: { count: 1, last_request_at: 0 },
    now: 100,
    limits,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "DEMO_COOLDOWN");
  assert.equal(result.quota.cooldownSeconds, 3);
});

test("decideQuota allows available quota", () => {
  const result = decideQuota({
    deviceRow: { count: 12, last_request_at: 90 },
    ipRow: { count: 31, last_request_at: 0 },
    now: 100,
    limits,
  });

  assert.equal(result.ok, true);
  assert.equal(result.quota.deviceUsed, 12);
  assert.equal(result.quota.ipUsed, 31);
});

test("loadUsage returns zero defaults when row is missing", async () => {
  let sql;
  let bound;
  const db = {
    prepare(query) {
      sql = query;
      return {
        bind(...args) {
          bound = args;
          return {
            async first() {
              return undefined;
            },
          };
        },
      };
    },
  };

  const row = await loadUsage(db, "device", "abc", "2026-07-02");

  assert.match(sql, /SELECT count, last_request_at FROM daily_usage/);
  assert.deepEqual(bound, ["device", "abc", "2026-07-02"]);
  assert.deepEqual(row, { count: 0, last_request_at: 0 });
});

test("touchCooldown writes a cooldown row", async () => {
  let sql;
  let bound;
  let ran = false;
  const db = {
    prepare(query) {
      sql = query;
      return {
        bind(...args) {
          bound = args;
          return {
            async run() {
              ran = true;
            },
          };
        },
      };
    },
  };

  await touchCooldown(db, "device", "abc", "2026-07-02", 123);

  assert.match(sql, /INSERT INTO daily_usage/);
  assert.deepEqual(bound, ["device", "abc", "2026-07-02", 123]);
  assert.equal(ran, true);
});

test("incrementUsage writes an increment row", async () => {
  let sql;
  let bound;
  let ran = false;
  const db = {
    prepare(query) {
      sql = query;
      return {
        bind(...args) {
          bound = args;
          return {
            async run() {
              ran = true;
            },
          };
        },
      };
    },
  };

  await incrementUsage(db, "device", "abc", "2026-07-02", 123);

  assert.match(sql, /INSERT INTO daily_usage/);
  assert.deepEqual(bound, ["device", "abc", "2026-07-02", 123]);
  assert.equal(ran, true);
});

test("claimQuota reserves device and ip usage", async () => {
  const prepared = [];
  const db = {
    prepare(query) {
      return {
        bind(...args) {
          prepared.push({ query, args });
          return {
            async run() {},
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

              return undefined;
            },
          };
        },
      };
    },
  };

  const result = await claimQuota(db, {
    deviceHash: "device-hash",
    ipHash: "ip-hash",
    date: "2026-07-02",
    now: 100,
    limits,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.quota, {
    deviceUsed: 2,
    deviceLimit: 50,
    ipUsed: 3,
    ipLimit: 150,
    cooldownSeconds: 5,
  });
  assert.match(prepared[0].query, /INSERT OR IGNORE INTO daily_usage/);
  assert.deepEqual(prepared[0].args, ["device", "device-hash", "2026-07-02"]);
  assert.match(prepared[1].query, /UPDATE daily_usage/);
  assert.deepEqual(prepared[1].args, [100, "device", "device-hash", "2026-07-02", 50, 100, 5]);
  assert.deepEqual(prepared[2].args, ["ip", "ip-hash", "2026-07-02"]);
  assert.deepEqual(prepared[3].args, [100, "ip", "ip-hash", "2026-07-02", 150]);
});

test("releaseQuota decrements reserved usage", async () => {
  let sql;
  let bound;
  let ran = false;
  const db = {
    prepare(query) {
      sql = query;
      return {
        bind(...args) {
          bound = args;
          return {
            async run() {
              ran = true;
            },
          };
        },
      };
    },
  };

  await releaseQuota(db, "device", "abc", "2026-07-02");

  assert.match(sql, /SET count = CASE WHEN count > 0 THEN count - 1 ELSE 0 END/);
  assert.deepEqual(bound, ["device", "abc", "2026-07-02"]);
  assert.equal(ran, true);
});

test("claimQuota SQL runs on real sqlite", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE daily_usage (
      scope TEXT NOT NULL,
      hash TEXT NOT NULL,
      date TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      last_request_at INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (scope, hash, date)
    );
  `);

  const db = {
    prepare(query) {
      const statement = sqlite.prepare(query);
      return {
        bind(...args) {
          return {
            async first() {
              return statement.get(...args);
            },
            async run() {
              statement.run(...args);
            },
          };
        },
      };
    },
  };

  const result = await claimQuota(db, {
    deviceHash: "device-hash",
    ipHash: "ip-hash",
    date: "2026-07-02",
    now: 100,
    limits,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.quota, {
    deviceUsed: 1,
    deviceLimit: 50,
    ipUsed: 1,
    ipLimit: 150,
    cooldownSeconds: 5,
  });
});

test("claimQuota re-reads current device state when claim fails", async () => {
  let deviceSelectCount = 0;
  const db = {
    prepare(query) {
      return {
        bind(...args) {
          return {
            async run() {},
            async first() {
              if (query.includes("SELECT count, last_request_at FROM daily_usage") && args[0] === "device") {
                deviceSelectCount += 1;
                return deviceSelectCount === 1
                  ? { count: 50, last_request_at: 100 }
                  : { count: 50, last_request_at: 100 };
              }

              if (query.includes("UPDATE daily_usage") && args[1] === "device") {
                return undefined;
              }

              return undefined;
            },
          };
        },
      };
    },
  };

  const result = await claimQuota(db, {
    deviceHash: "device-hash",
    ipHash: "ip-hash",
    date: "2026-07-02",
    now: 100,
    limits,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "DEMO_QUOTA_DEVICE");
});
