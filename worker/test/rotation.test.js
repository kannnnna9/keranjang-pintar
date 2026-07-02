import test from "node:test";
import assert from "node:assert/strict";
import {
  advanceCursor,
  loadCursor,
  loadHealthySlots,
  markKeyResult,
  orderedSlots,
  secretForSlot,
} from "../src/rotation.js";

test("orderedSlots starts at cursor and wraps", () => {
  assert.deepEqual(orderedSlots(1), [1, 2, 3]);
  assert.deepEqual(orderedSlots(2), [2, 3, 1]);
  assert.deepEqual(orderedSlots(3), [3, 1, 2]);
});

test("secretForSlot reads exact environment secret", () => {
  const env = {
    GEMINI_KEY_1: "key-a",
    GEMINI_KEY_2: "key-b",
    GEMINI_KEY_3: "key-c",
  };

  assert.equal(secretForSlot(env, 2), "key-b");
});

test("loadCursor falls back to slot 1 when state is missing", async () => {
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

  const cursor = await loadCursor(db);

  assert.match(sql, /SELECT value FROM runtime_state/);
  assert.deepEqual(bound, ["rr_cursor"]);
  assert.equal(cursor, 1);
});

test("loadHealthySlots returns numeric healthy slots", async () => {
  let sql;
  let bound;
  const db = {
    prepare(query) {
      sql = query;
      return {
        bind(...args) {
          bound = args;
          return {
            async all() {
              return { results: [{ slot: "2" }, { slot: 3 }] };
            },
          };
        },
      };
    },
  };

  const slots = await loadHealthySlots(db, 123);

  assert.match(sql, /SELECT slot FROM demo_keys/);
  assert.deepEqual(bound, ["healthy", 123]);
  assert.deepEqual(slots, [2, 3]);
});

test("advanceCursor persists the next slot", async () => {
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

  await advanceCursor(db, 3, 456);

  assert.match(sql, /INSERT INTO runtime_state/);
  assert.deepEqual(bound, ["1", 456]);
  assert.equal(ran, true);
});

test("markKeyResult clears failure state after success", async () => {
  let sql;
  let bound;
  const db = {
    prepare(query) {
      sql = query;
      return {
        bind(...args) {
          bound = args;
          return {
            async run() {},
          };
        },
      };
    },
  };

  await markKeyResult(db, 2, "success", 100);

  assert.match(sql, /fail_count = 0/);
  assert.deepEqual(bound, [100, 2]);
});

test("markKeyResult cools down rate-limited keys", async () => {
  let sql;
  let bound;
  const db = {
    prepare(query) {
      sql = query;
      return {
        bind(...args) {
          bound = args;
          return {
            async run() {},
          };
        },
      };
    },
  };

  await markKeyResult(db, 2, "rate_limited", 100);

  assert.match(sql, /cooldown_until = \?/);
  assert.deepEqual(bound, [160, "429", 100, 2]);
});

test("markKeyResult disables auth-broken keys", async () => {
  let sql;
  let bound;
  const db = {
    prepare(query) {
      sql = query;
      return {
        bind(...args) {
          bound = args;
          return {
            async run() {},
          };
        },
      };
    },
  };

  await markKeyResult(db, 3, "disabled", 200);

  assert.match(sql, /status = 'disabled'/);
  assert.deepEqual(bound, ["AUTH", 200, 3]);
});

test("markKeyResult records transient failures", async () => {
  let sql;
  let bound;
  const db = {
    prepare(query) {
      sql = query;
      return {
        bind(...args) {
          bound = args;
          return {
            async run() {},
          };
        },
      };
    },
  };

  await markKeyResult(db, 1, "transient", 300);

  assert.match(sql, /last_error_code = \?/);
  assert.deepEqual(bound, ["TRANSIENT", 300, 1]);
});
