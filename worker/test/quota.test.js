import test from "node:test";
import assert from "node:assert/strict";
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

test("claimQuota atomically reserves device and ip usage", async () => {
  const prepared = [];
  const db = {
    prepare(query) {
      return {
        bind(...args) {
          prepared.push({ query, args });
          return {
            async first() {
              if (query.includes("FROM daily_usage") && args[0] === "device") {
                return {
                  count: 2,
                  last_request_at: 100,
                  claimed: 1,
                  previous_count: 1,
                  previous_last_request_at: 0,
                };
              }

              if (query.includes("FROM daily_usage") && args[0] === "ip") {
                return {
                  count: 3,
                  last_request_at: 100,
                  claimed: 1,
                  previous_count: 2,
                  previous_last_request_at: 0,
                };
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
  assert.match(prepared[0].query, /RETURNING count, last_request_at/);
  assert.deepEqual(prepared[0].args, [
    "device",
    "device-hash",
    "2026-07-02",
    "device",
    "device-hash",
    "2026-07-02",
    100,
    50,
    100,
    5,
    50,
    100,
    5,
    50,
    100,
    5,
  ]);
  assert.deepEqual(prepared[1].args, [
    "ip",
    "ip-hash",
    "2026-07-02",
    "ip",
    "ip-hash",
    "2026-07-02",
    100,
    150,
    150,
  ]);
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
