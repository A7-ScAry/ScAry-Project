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
  reply_to_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 1200),
  created_at INTEGER NOT NULL,
  UNIQUE(room_id,guest_id,client_nonce)
);
CREATE INDEX IF NOT EXISTS messages_room_time_idx ON messages(room_id,created_at,id);
CREATE INDEX IF NOT EXISTS messages_reply_idx ON messages(room_id,reply_to_id);
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

-- Message replies and single-choice reactions (new databases only).
-- Existing deployed databases MUST use migration_message_interactions.sql instead.
CREATE TABLE IF NOT EXISTS message_reactions (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  guest_id TEXT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL CHECK(emoji IN ('👍🏽','😂','😮','😢','😡','😭','🥀')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (message_id, guest_id)
);
CREATE INDEX IF NOT EXISTS message_reactions_emoji_idx ON message_reactions(message_id, emoji);
-- ScAry Project live D1 migration: notifications. Safe ADDITIVE change; run ONCE.
-- Only scary-project-db. NEVER run on ScAry Net (scary-net-db).
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  guest_id TEXT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  endpoint_hash TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  muted INTEGER NOT NULL DEFAULT 0 CHECK(muted IN (0,1)),
  preview_enabled INTEGER NOT NULL DEFAULT 0 CHECK(preview_enabled IN (0,1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(room_id, guest_id, endpoint_hash)
);
CREATE INDEX IF NOT EXISTS push_room_recipients_idx ON push_subscriptions(room_id,muted,guest_id);
CREATE INDEX IF NOT EXISTS push_guest_idx ON push_subscriptions(guest_id,updated_at DESC);
