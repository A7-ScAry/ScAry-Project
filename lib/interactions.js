// Shared reaction validation and per-message summary data. No user text is HTML-rendered.
import { fail } from './core.js';
export const REACTIONS = Object.freeze(['👍🏽', '😂', '😮', '😢', '😡', '😭', '🥀']);
export const MESSAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validMessageId(id) {
  if (typeof id !== 'string' || !MESSAGE_ID.test(id)) fail(400, 'Invalid message ID.');
  return id.toLowerCase();
}
export function validEmoji(emoji) {
  if (!REACTIONS.includes(emoji)) fail(400, 'Choose a supported reaction.');
  return emoji;
}
// Restrict requested IDs to the room and the guest's visible message history.
export async function reactionSummaries(db, room, guest, ids) {
  const unique=[...new Set(ids)].slice(0,100);
  if (!unique.length) return {};
  const placeholders=unique.map(()=>'?').join(',');
  const visibleSince=guest.is_host ? 0 : guest.joined_at;
  const rows=await db.prepare(`SELECT r.message_id AS messageId, r.emoji,
      COUNT(*) AS count, MAX(CASE WHEN r.guest_id = ? THEN 1 ELSE 0 END) AS mine
    FROM message_reactions r JOIN messages m ON m.id = r.message_id
    WHERE m.room_id = ? AND m.created_at >= ? AND r.message_id IN (${placeholders})
    GROUP BY r.message_id, r.emoji`)
    .bind(guest.id,room.id,visibleSince,...unique).all();
  const result=Object.fromEntries(unique.map(id=>[id,{reactions:[],myReaction:null}]));
  for (const row of rows.results || []) {
    const item=result[row.messageId];if (!item) continue;
    item.reactions.push({emoji:row.emoji,count:Number(row.count)});
    if (row.mine) item.myReaction=row.emoji;
  }
  for (const item of Object.values(result))
    item.reactions.sort((a,b)=>REACTIONS.indexOf(a.emoji)-REACTIONS.indexOf(b.emoji));
  return result;
}
