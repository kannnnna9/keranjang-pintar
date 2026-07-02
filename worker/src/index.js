import { callGemini } from "./gemini.js";
import { corsHeaders, jsonError, jsonOk, parseDemoScanRequest, PublicError } from "./http.js";
import { clientIp, hashIdentifier, todayUtc } from "./identity.js";
import { claimQuota, releaseQuota } from "./quota.js";
import {
  advanceCursor,
  loadCursor,
  loadHealthySlots,
  markKeyResult,
  orderedSlots,
  secretForSlot,
} from "./rotation.js";

export default {
  async fetch(request, env) {
    const origin = request.headers.get("origin") || "";
    const cors = corsHeaders(origin, env);
    const path = new URL(request.url).pathname;

    if (request.method === "OPTIONS") {
      if (!cors["Access-Control-Allow-Origin"]) {
        return jsonError("ORIGIN_DENIED", "Origin tidak diizinkan.", 403);
      }

      return new Response(null, { status: 204, headers: cors });
    }

    if (origin && !cors["Access-Control-Allow-Origin"]) {
      return jsonError("ORIGIN_DENIED", "Origin tidak diizinkan.", 403);
    }

    if (path === "/health") {
      return jsonOk(undefined, undefined, { headers: cors });
    }

    if (path !== "/v1/demo/scan") {
      return jsonError("NOT_FOUND", "Not found.", 404, undefined, cors);
    }

    if (!cors["Access-Control-Allow-Origin"]) {
      return jsonError("ORIGIN_DENIED", "Origin tidak diizinkan.", 403, undefined, cors);
    }

    try {
      return await handleDemoScan(request, env, cors);
    } catch (error) {
      if (error instanceof PublicError) {
        return jsonError(error.code, error.message, error.status, error.quota, cors);
      }

      return jsonError(
        "GEMINI_UNAVAILABLE",
        "Demo sedang tidak tersedia. Coba lagi nanti atau pakai API key sendiri.",
        503,
        undefined,
        cors,
      );
    }
  },
};

async function handleDemoScan(request, env, cors) {
  const now = Math.floor(Date.now() / 1000);
  const date = todayUtc(new Date(now * 1000));
  const limits = {
    deviceDailyLimit: Number(env.DEVICE_DAILY_LIMIT || 50),
    ipDailyLimit: Number(env.IP_DAILY_LIMIT || 150),
    cooldownSeconds: Number(env.DEVICE_COOLDOWN_SECONDS || 5),
  };
  const { deviceId, imageBase64 } = await parseDemoScanRequest(request);
  const salt = String(env.HASH_SALT || "");
  if (!salt) {
    throw new Error("Missing HASH_SALT");
  }
  const deviceHash = await hashIdentifier(deviceId, salt);
  const ipHash = await hashIdentifier(clientIp(request), salt);
  const decision = await claimQuota(env.DB, {
    deviceHash,
    ipHash,
    date,
    now,
    limits,
  });

  if (!decision.ok) {
    throw new PublicError(decision.code, decision.message, decision.status, decision.quota);
  }

  try {
    const result = await callWithRotation(env, imageBase64, now);

    await recordScanEvent(env.DB, {
      now,
      deviceHash,
      ipHash,
      keySlot: result.slot,
      outcome: "success",
    });

    return jsonOk(result.data, decision.quota, { headers: cors });
  } catch (error) {
    await releaseQuota(env.DB, "device", deviceHash, date);
    await releaseQuota(env.DB, "ip", ipHash, date);
    throw error;
  }
}

async function callWithRotation(env, imageBase64, now) {
  const cursor = await loadCursor(env.DB);
  const healthy = new Set(await loadHealthySlots(env.DB, now));
  const slots = orderedSlots(cursor).filter((slot) => healthy.has(slot));

  for (const slot of slots) {
    const apiKey = secretForSlot(env, slot);
    if (!apiKey) {
      continue;
    }

    try {
      const data = await callGemini({
        apiKey,
        imageBase64,
        model: env.GEMINI_MODEL || "gemini-3.1-flash-lite",
      });
      await markKeyResult(env.DB, slot, "success", now);
      await advanceCursor(env.DB, slot, now);
      return { slot, data };
    } catch (error) {
      const kind = error.classification?.kind || "transient";
      await markKeyResult(env.DB, slot, kind, now);
      if (kind === "permanent") {
        throw error;
      }
    }
  }

  throw new PublicError(
    "DEMO_EXHAUSTED",
    "Kuota demo habis hari ini. Coba lagi besok atau pakai API key sendiri.",
    503,
  );
}

async function recordScanEvent(db, event) {
  await db
    .prepare(
      `INSERT INTO scan_events (created_at, device_hash, ip_hash, key_slot, outcome, error_code)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      event.now,
      event.deviceHash,
      event.ipHash,
      event.keySlot || null,
      event.outcome,
      event.errorCode || null,
    )
    .run();
}
