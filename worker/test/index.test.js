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
