CREATE TABLE IF NOT EXISTS daily_usage (
  scope TEXT NOT NULL,
  hash TEXT NOT NULL,
  date TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  last_request_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, hash, date)
);

CREATE TABLE IF NOT EXISTS demo_keys (
  slot INTEGER PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'healthy',
  cooldown_until INTEGER NOT NULL DEFAULT 0,
  fail_count INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS runtime_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS scan_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  device_hash TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  key_slot INTEGER,
  outcome TEXT NOT NULL,
  error_code TEXT
);

INSERT OR IGNORE INTO demo_keys (slot, status, updated_at) VALUES
  (1, 'healthy', 0),
  (2, 'healthy', 0),
  (3, 'healthy', 0);

INSERT OR IGNORE INTO runtime_state (key, value, updated_at)
VALUES ('rr_cursor', '1', 0);
