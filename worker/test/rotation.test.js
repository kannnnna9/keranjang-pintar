import test from "node:test";
import assert from "node:assert/strict";
import { orderedSlots, secretForSlot } from "../src/rotation.js";

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
