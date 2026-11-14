// Authenticated lightweight room summary for the device-local My Rooms list.
// The invite link alone never reveals unread counts or guest identity.
import { run, reply, fail, getRoom, getGuest, publicRoom, publicGuest } from '../../../../lib/core.js';

export const onRequestGet = context => run(context, async () => {
  const db = context.env.DB;
  const room = await getRoom(db, context.params.code);
  const guest = await getGuest(db, context.request, room, { allowPending:true, allowInactive:true });
  const count = await db.prepare("SELECT COUNT(*) AS n FROM guests WHERE room_id = ? AND status = 'active'")
    .bind(room.id).first();
  const url = new URL(context.request.url);
  const afterInput = url.searchParams.get('after') || '0';
  if (!/^\d{1,16}$/.test(afterInput)) fail(400, 'Invalid last-read timestamp.');
  const after = Number(afterInput);
  if (!Number.isSafeInteger(after)) fail(400, 'Invalid last-read timestamp.');
  let unread = 0;
  if (guest.status === 'active' && room.expires_at > Date.now()) {
    const result = await db.prepare(`
      SELECT COUNT(*) AS n FROM messages
      WHERE room_id = ? AND created_at > ? AND created_at >= ? AND guest_id != ?
    `).bind(room.id, after, guest.is_host ? 0 : guest.joined_at, guest.id).first();
    unread = Math.min(999, result?.n || 0);
  }
  return reply({ room: publicRoom(room, count?.n || 0), guest: publicGuest(guest), unread });
});
