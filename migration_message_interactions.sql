-- ScAry Project ONLY — safe additive migration for EXISTING scary-project-db.
-- Run against scary-project-db, NEVER scary-net-db. Do not rerun schema.sql.
-- Back up the existing database first.
ALTER TABLE messages ADD COLUMN reply_to_id TEXT REFERENCES messages(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS messages_reply_idx ON messages(room_id, reply_to_id);
CREATE TABLE IF NOT EXISTS message_reactions (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  guest_id TEXT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL CHECK(emoji IN ('👍🏽','😂','😮','😢','😡','😭','🥀')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (message_id, guest_id)
);
CREATE INDEX IF NOT EXISTS message_reactions_emoji_idx ON message_reactions(message_id, emoji);
