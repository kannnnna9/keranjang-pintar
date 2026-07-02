export function orderedSlots(cursor) {
  const start = Number(cursor) || 1;
  return [0, 1, 2].map((offset) => ((start - 1 + offset) % 3) + 1);
}

export function secretForSlot(env, slot) {
  return env[`GEMINI_KEY_${slot}`] || "";
}

export async function loadCursor(db) {
  const row = await db
    .prepare("SELECT value FROM runtime_state WHERE key = ?")
    .bind("rr_cursor")
    .first();

  return Number(row?.value || 1);
}

export async function loadHealthySlots(db, now) {
  const result = await db
    .prepare("SELECT slot FROM demo_keys WHERE status = ? AND cooldown_until <= ? ORDER BY slot ASC")
    .bind("healthy", now)
    .all();

  return (result.results || []).map((row) => Number(row.slot));
}

export async function advanceCursor(db, slot, now) {
  const next = (Number(slot) % 3) + 1;
  await db
    .prepare(
      `INSERT INTO runtime_state (key, value, updated_at)
       VALUES ('rr_cursor', ?, ?)
       ON CONFLICT(key)
       DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(String(next), now)
    .run();
}

export async function markKeyResult(db, slot, result, now) {
  if (result === "success") {
    await db
      .prepare("UPDATE demo_keys SET fail_count = 0, last_error_code = NULL, updated_at = ? WHERE slot = ?")
      .bind(now, slot)
      .run();
    return;
  }

  if (result === "rate_limited") {
    await db
      .prepare("UPDATE demo_keys SET cooldown_until = ?, fail_count = fail_count + 1, last_error_code = ?, updated_at = ? WHERE slot = ?")
      .bind(now + 60, "429", now, slot)
      .run();
    return;
  }

  if (result === "disabled") {
    await db
      .prepare("UPDATE demo_keys SET status = 'disabled', fail_count = fail_count + 1, last_error_code = ?, updated_at = ? WHERE slot = ?")
      .bind("AUTH", now, slot)
      .run();
    return;
  }

  await db
    .prepare("UPDATE demo_keys SET fail_count = fail_count + 1, last_error_code = ?, updated_at = ? WHERE slot = ?")
    .bind("TRANSIENT", now, slot)
    .run();
}
