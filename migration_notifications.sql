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
