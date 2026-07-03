const MAX_BASE64_CHARS = 1_500_000;
const JPEG_MAGIC_BYTES = [0xff, 0xd8, 0xff];

export class PublicError extends Error {
  constructor(code, message, status = 400, quota = undefined) {
    super(message);
    this.code = code;
    this.status = status;
    this.quota = quota;
  }
}

export function corsHeaders(origin, env) {
  const allowed = String(env?.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const headers = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };

  if (origin && allowed.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}

export function jsonOk(data, quota, init = {}) {
  const body = { ok: true };

  if (data !== undefined) {
    body.data = data;
  }

  if (quota !== undefined) {
    body.quota = quota;
  }

  return Response.json(body, { status: init.status ?? 200, headers: init.headers || {} });
}

export function jsonError(code, message, status, quota = undefined, headers = {}) {
  const body = { ok: false, code, message };

  if (quota !== undefined) {
    body.quota = quota;
  }

  return Response.json(body, { status, headers });
}

export async function parseDemoScanRequest(request) {
  if (request.method !== "POST") {
    throw new PublicError("BAD_REQUEST", "Metode request tidak valid.", 405);
  }

  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new PublicError("BAD_REQUEST", "Content-Type harus application/json.", 400);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    throw new PublicError("BAD_REQUEST", "JSON tidak valid.", 400);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new PublicError("BAD_REQUEST", "JSON tidak valid.", 400);
  }

  const deviceId = typeof body.deviceId === "string" ? body.deviceId.trim() : "";
  const imageBase64 = typeof body.imageBase64 === "string" ? body.imageBase64.trim() : "";

  if (!deviceId) {
    throw new PublicError("BAD_REQUEST", "deviceId wajib diisi.", 400);
  }

  if (!imageBase64) {
    throw new PublicError("BAD_REQUEST", "imageBase64 wajib diisi.", 400);
  }

  if (imageBase64.length > MAX_BASE64_CHARS) {
    throw new PublicError("BAD_REQUEST", "Ukuran gambar terlalu besar.", 413);
  }

  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(imageBase64)) {
    throw new PublicError("BAD_REQUEST", "Format gambar tidak valid.", 400);
  }

  if (!isJpegBase64(imageBase64)) {
    throw new PublicError("BAD_REQUEST", "Gambar harus berupa JPEG valid.", 400);
  }

  return { deviceId, imageBase64 };
}

function isJpegBase64(imageBase64) {
  try {
    const binary = atob(imageBase64.slice(0, 16));
    return JPEG_MAGIC_BYTES.every((byte, index) => binary.charCodeAt(index) === byte);
  } catch {
    return false;
  }
}
