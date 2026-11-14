import { run, reply, fail, payload, getRoom, alive, getGuest, rateLimit } from '../../../../lib/core.js';
import { validMessageId, validEmoji, reactionSummaries } from '../../../../lib/interactions.js';

// One reaction per guest per message: tap to add, tap again to remove, or choose a different emoji.
export const onRequestPost = context => run(context, async () => {
  const db=context.env.DB,room=await getRoom(db,context.params.code);
  alive(room);
  const guest=await getGuest(db,context.request,room);
  await rateLimit(context,`reaction:${room.id}:${guest.id}`,90,60*1000);
  const data=await payload(context.request);
  const messageId=validMessageId(data.messageId),emoji=validEmoji(data.emoji);
  const visibleSince=guest.is_host ? 0 : guest.joined_at;
  const target=await db.prepare('SELECT id FROM messages WHERE id = ? AND room_id = ? AND created_at >= ?')
    .bind(messageId,room.id,visibleSince).first();
  if (!target) fail(404,'Message not found in your room history.');
  const existing=await db.prepare('SELECT emoji FROM message_reactions WHERE message_id = ? AND guest_id = ?')
    .bind(messageId,guest.id).first();
  if (existing?.emoji === emoji) {
    await db.prepare('DELETE FROM message_reactions WHERE message_id = ? AND guest_id = ?')
      .bind(messageId,guest.id).run();
  } else {
    await db.prepare(`INSERT INTO message_reactions(message_id,guest_id,emoji,created_at) VALUES(?,?,?,?)
      ON CONFLICT(message_id,guest_id) DO UPDATE SET emoji=excluded.emoji,created_at=excluded.created_at`)
      .bind(messageId,guest.id,emoji,Date.now()).run();
  }
  const summary=(await reactionSummaries(db,room,guest,[messageId]))[messageId];
  return reply({messageId,...summary});
});
