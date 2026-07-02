import test from "node:test";
import assert from "node:assert/strict";
import {
  corsHeaders,
  jsonError,
  parseDemoScanRequest,
} from "../src/http.js";

test("corsHeaders allows configured origins only", () => {
  const env = { ALLOWED_ORIGINS: "https://kannnnna9.github.io,http://localhost:8000" };

  assert.equal(corsHeaders("https://kannnnna9.github.io", env)["Access-Control-Allow-Origin"], "https://kannnnna9.github.io");
  assert.equal(corsHeaders("https://evil.example", env)["Access-Control-Allow-Origin"], undefined);
});

test("jsonError uses safe envelope", async () => {
  const response = jsonError("BAD_REQUEST", "Payload tidak valid.", 400);
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.deepEqual(body, {
    ok: false,
    code: "BAD_REQUEST",
    message: "Payload tidak valid.",
  });
});

test("parseDemoScanRequest rejects missing fields", async () => {
  const request = new Request("https://worker.test/v1/demo/scan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceId: "abc" }),
  });

  await assert.rejects(
    () => parseDemoScanRequest(request),
    /imageBase64 wajib diisi/
  );
});

test("parseDemoScanRequest accepts bounded jpeg base64 payload", async () => {
  const request = new Request("https://worker.test/v1/demo/scan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      deviceId: "device-123",
      imageBase64: "aGVsbG8=",
    }),
  });

  assert.deepEqual(await parseDemoScanRequest(request), {
    deviceId: "device-123",
    imageBase64: "aGVsbG8=",
  });
});
