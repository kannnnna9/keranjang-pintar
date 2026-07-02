const SOFT_QUOTA_MESSAGE = "Kuota demo habis hari ini. Coba lagi besok atau pakai API key sendiri.";

export function quotaSnapshot(deviceRow, ipRow, limits, cooldownSeconds = 0) {
  return {
    deviceUsed: deviceRow?.count || 0,
    deviceLimit: limits.deviceDailyLimit,
    ipUsed: ipRow?.count || 0,
    ipLimit: limits.ipDailyLimit,
    cooldownSeconds,
  };
}

export function decideQuota({ deviceRow, ipRow, now, limits }) {
  const deviceCount = deviceRow?.count || 0;
  const ipCount = ipRow?.count || 0;
  const lastRequestAt = deviceRow?.last_request_at || 0;

  if (deviceCount >= limits.deviceDailyLimit) {
    return {
      ok: false,
      code: "DEMO_QUOTA_DEVICE",
      message: SOFT_QUOTA_MESSAGE,
      quota: quotaSnapshot(deviceRow, ipRow, limits),
      status: 429,
    };
  }

  if (ipCount >= limits.ipDailyLimit) {
    return {
      ok: false,
      code: "DEMO_QUOTA_IP",
      message: SOFT_QUOTA_MESSAGE,
      quota: quotaSnapshot(deviceRow, ipRow, limits),
      status: 429,
    };
  }

  const elapsed = now - lastRequestAt;
  if (lastRequestAt > 0 && elapsed < limits.cooldownSeconds) {
    const cooldownSeconds = Math.ceil(limits.cooldownSeconds - elapsed);
    return {
      ok: false,
      code: "DEMO_COOLDOWN",
      message: `Tunggu sebentar… ${cooldownSeconds} detik.`,
      quota: quotaSnapshot(deviceRow, ipRow, limits, cooldownSeconds),
      status: 429,
    };
  }

  return {
    ok: true,
    quota: quotaSnapshot(deviceRow, ipRow, limits),
  };
}

export async function loadUsage(db, scope, hash, date) {
  const row = await db
    .prepare("SELECT count, last_request_at FROM daily_usage WHERE scope = ? AND hash = ? AND date = ?")
    .bind(scope, hash, date)
    .first();

  return row || { count: 0, last_request_at: 0 };
}

export async function touchCooldown(db, scope, hash, date, now) {
  await db
    .prepare(
      `INSERT INTO daily_usage (scope, hash, date, count, last_request_at)
       VALUES (?, ?, ?, 0, ?)
       ON CONFLICT(scope, hash, date)
       DO UPDATE SET last_request_at = excluded.last_request_at`,
    )
    .bind(scope, hash, date, now)
    .run();
}

export async function incrementUsage(db, scope, hash, date, now) {
  await db
    .prepare(
      `INSERT INTO daily_usage (scope, hash, date, count, last_request_at)
       VALUES (?, ?, ?, 1, ?)
       ON CONFLICT(scope, hash, date)
       DO UPDATE SET count = count + 1, last_request_at = excluded.last_request_at`,
    )
    .bind(scope, hash, date, now)
    .run();
}
