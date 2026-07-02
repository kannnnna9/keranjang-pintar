import test from "node:test";
import assert from "node:assert/strict";
import { clientIp, hashIdentifier, todayUtc } from "../src/identity.js";

test("todayUtc formats YYYY-MM-DD in UTC", () => {
  assert.equal(todayUtc(new Date("2026-07-02T23:59:59Z")), "2026-07-02");
});

test("hashIdentifier is deterministic and does not expose raw value", async () => {
  const first = await hashIdentifier("device-abc", "salt-1");
  const second = await hashIdentifier("device-abc", "salt-1");

  assert.equal(first, second);
  assert.notEqual(first, "device-abc");
  assert.equal(first.length, 64);
});

test("clientIp reads Cloudflare connecting IP first", () => {
  const request = new Request("https://worker.test", {
    headers: {
      "cf-connecting-ip": "203.0.113.5",
      "x-forwarded-for": "198.51.100.10",
    },
  });

  assert.equal(clientIp(request), "203.0.113.5");
});
