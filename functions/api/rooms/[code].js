import { run, reply, getRoom, publicRoom, publicGuest, sha256 } from '../../../lib/core.js';

export const onRequestGet = context => run(context, async () => {
  const db = context.env.DB;
  const room = await getRoom(db,context.params.code);
  const count = await db.prepare("SELECT COUNT(*) AS n FROM guests WHERE room_id = ? AND status = 'active'").bind(room.id).first();
  const token = context.request.headers.get('X-Room-Token') || '';
  let guest = null;
  if (/^[0-9a-f]{64}$/.test(token)) {
    guest = await db.prepare('SELECT * FROM guests WHERE room_id = ? AND token_hash = ?').bind(room.id,await sha256(token)).first();
  }
  return reply({ room:publicRoom(room,count?.n || 0), guest:publicGuest(guest) });
});
