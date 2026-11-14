-- ScAry Project ONLY. Never execute against ScAry Net's database.
-- New standalone D1 database: scary-project-db
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  password_salt TEXT,
  password_hash TEXT,
  approval_required INTEGER NOT NULL DEFAULT 0,
  locked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rooms_expiry_idx ON rooms(expires_at);
CREATE TABLE IF NOT EXISTS guests (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  nickname TEXT NOT NULL,
  nickname_key TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  is_host INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending','kicked','banned','left')),
  joined_at INTEGER NOT NULL,
  UNIQUE(room_id,nickname_key)
);
CREATE INDEX IF NOT EXISTS guests_room_status_idx ON guests(room_id,status);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  guest_id TEXT NOT NULL REFERENCES guests(id),
  client_nonce TEXT NOT NULL,
  body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 1200),
  created_at INTEGER NOT NULL,
  UNIQUE(room_id,guest_id,client_nonce)
);
CREATE INDEX IF NOT EXISTS messages_room_time_idx ON messages(room_id,created_at,id);
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  reporter_id TEXT NOT NULL REFERENCES guests(id),
  target_id TEXT NOT NULL REFERENCES guests(id),
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS reports_room_idx ON reports(room_id,created_at DESC);
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  hits INTEGER NOT NULL,
  resets_at INTEGER NOT NULL
);
