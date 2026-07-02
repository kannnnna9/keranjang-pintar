import test from "node:test";
import assert from "node:assert/strict";
import { callGemini, classifyGeminiStatus, parseGeminiText } from "../src/gemini.js";

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

test("parseGeminiText rejects null payloads with a user-safe error", () => {
  assert.throws(
    () => parseGeminiText("null"),
    /Format hasil tidak terbaca/,
  );
});

test("parseGeminiText coerces nama to a string", () => {
  assert.deepEqual(parseGeminiText("{\"nama\":123,\"harga\":5000}"), {
    nama: "123",
    harga: 5000,
  });
});

test("classifyGeminiStatus maps auth, quota, and server errors", () => {
  assert.equal(classifyGeminiStatus(401).kind, "disabled");
  assert.equal(classifyGeminiStatus(403).kind, "disabled");
  assert.equal(classifyGeminiStatus(429).kind, "rate_limited");
  assert.equal(classifyGeminiStatus(503).kind, "transient");
  assert.equal(classifyGeminiStatus(400).kind, "permanent");
});

test("callGemini parses success responses and sends api key in a header", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return Response.json({
      candidates: [
        {
          content: {
            parts: [
              { text: "```json\n{\"nama\":\"Teh\",\"harga\":5000}\n```" },
            ],
          },
        },
      ],
    });
  };

  const result = await callGemini({
    apiKey: "demo-key",
    imageBase64: "aGVsbG8=",
    model: "gemini-3.1-flash-lite",
    fetchImpl,
  });

  assert.deepEqual(result, { nama: "Teh", harga: 5000 });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /gemini-3\.1-flash-lite:generateContent$/);
  assert.equal(calls[0].init.headers["x-goog-api-key"], "demo-key");
  assert.equal(calls[0].init.headers["Content-Type"], "application/json");
  assert.equal(JSON.parse(calls[0].init.body).contents[0].parts[1].inline_data.data, "aGVsbG8=");
});

test("callGemini classifies non-ok responses without leaking bodies", async () => {
  const fetchImpl = async () => new Response("nope", { status: 429 });

  await assert.rejects(
    () => callGemini({
      apiKey: "demo-key",
      imageBase64: "aGVsbG8=",
      model: "gemini-3.1-flash-lite",
      fetchImpl,
    }),
    (error) => error.status === 429 && error.classification.kind === "rate_limited" && error.message === "Gemini unavailable"
  );
});
