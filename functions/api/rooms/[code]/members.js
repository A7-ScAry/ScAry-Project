import { run, reply, getRoom, alive, getGuest } from '../../../../lib/core.js';

export const onRequestGet = context => run(context, async () => {
  const db=context.env.DB,room=await getRoom(db,context.params.code);
  alive(room);
  const guest=await getGuest(db,context.request,room);
  const result=await db.prepare(`SELECT id, nickname, status, is_host AS isHost, joined_at AS joinedAt
    FROM guests WHERE room_id = ? AND (status = 'active' OR (? = 1 AND status = 'pending'))
    ORDER BY is_host DESC, joined_at ASC LIMIT 100`).bind(room.id,guest.is_host ? 1 : 0).all();
  return reply({ members:result.results || [], locked:!!room.locked, approvalRequired:!!room.approval_required });
});
