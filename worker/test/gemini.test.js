import test from "node:test";
import assert from "node:assert/strict";
import { classifyGeminiStatus, parseGeminiText } from "../src/gemini.js";

test("parseGeminiText accepts fenced JSON", () => {
  assert.deepEqual(parseGeminiText("```json\n{\"nama\":\"Susu\",\"harga\":18500}\n```"), {
    nama: "Susu",
    harga: 18500,
  });
});

test("parseGeminiText strips non-digits from price", () => {
  assert.deepEqual(parseGeminiText("{\"nama\":\"Roti\",\"harga\":\"Rp 12.000\"}"), {
    nama: "Roti",
    harga: 12000,
  });
});

test("classifyGeminiStatus maps auth, quota, and server errors", () => {
  assert.equal(classifyGeminiStatus(401).kind, "disabled");
  assert.equal(classifyGeminiStatus(403).kind, "disabled");
  assert.equal(classifyGeminiStatus(429).kind, "rate_limited");
  assert.equal(classifyGeminiStatus(503).kind, "transient");
  assert.equal(classifyGeminiStatus(400).kind, "permanent");
});
