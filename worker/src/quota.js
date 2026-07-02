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

export async function claimQuota(db, { deviceHash, ipHash, date, now, limits }) {
  const previousDevice = await loadUsage(db, "device", deviceHash, date);

  await db
    .prepare(
      `INSERT OR IGNORE INTO daily_usage (scope, hash, date, count, last_request_at)
       VALUES (?, ?, ?, 0, 0)`,
    )
    .bind("device", deviceHash, date)
    .run();

  const deviceRow = await db
    .prepare(
      `UPDATE daily_usage
       SET
         count = count + 1,
         last_request_at = ?
       WHERE scope = ? AND hash = ? AND date = ?
         AND count < ?
         AND (? - last_request_at) >= ?
       RETURNING count, last_request_at`,
    )
    .bind(
      now,
      "device",
      deviceHash,
      date,
      limits.deviceDailyLimit,
      now,
      limits.cooldownSeconds,
    )
    .first();

  if (!deviceRow) {
    return decideQuota({
      deviceRow: previousDevice,
      ipRow: { count: 0, last_request_at: 0 },
      now,
      limits,
    });
  }

  const previousIp = await loadUsage(db, "ip", ipHash, date);

  await db
    .prepare(
      `INSERT OR IGNORE INTO daily_usage (scope, hash, date, count, last_request_at)
       VALUES (?, ?, ?, 0, 0)`,
    )
    .bind("ip", ipHash, date)
    .run();

  const ipRow = await db
    .prepare(
      `UPDATE daily_usage
       SET
         count = count + 1,
         last_request_at = ?
       WHERE scope = ? AND hash = ? AND date = ?
         AND count < ?
       RETURNING count, last_request_at`,
    )
    .bind(
      now,
      "ip",
      ipHash,
      date,
      limits.ipDailyLimit,
    )
    .first();

  if (!ipRow) {
    await releaseQuota(db, "device", deviceHash, date);
    return decideQuota({
      deviceRow: previousDevice,
      ipRow: previousIp,
      now,
      limits,
    });
  }

  return {
    ok: true,
    quota: {
      deviceUsed: deviceRow.count,
      deviceLimit: limits.deviceDailyLimit,
      ipUsed: ipRow.count,
      ipLimit: limits.ipDailyLimit,
      cooldownSeconds: limits.cooldownSeconds,
    },
  };
}

export async function releaseQuota(db, scope, hash, date) {
  await db
    .prepare(
      `UPDATE daily_usage
       SET count = CASE WHEN count > 0 THEN count - 1 ELSE 0 END
       WHERE scope = ? AND hash = ? AND date = ?`,
    )
    .bind(scope, hash, date)
    .run();
}
