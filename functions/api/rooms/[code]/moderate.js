import { run, reply, fail, payload, getRoom, alive, getGuest, hostOnly, rateLimit } from '../../../../lib/core.js';

export const onRequestPost = context => run(context, async () => {
  const db=context.env.DB,room=await getRoom(db,context.params.code);
  alive(room);
  const guest=await getGuest(db,context.request,room);
  hostOnly(guest);
  await rateLimit(context,`moderate:${room.id}`,80,60*60*1000);
  const data=await payload(context.request);
  const action=data.action;
  if (['lock','unlock','approval_on','approval_off'].includes(action)) {
    const field=action.startsWith('approval') ? 'approval_required' : 'locked';
    const on=action==='lock' || action==='approval_on' ? 1 : 0;
    await db.prepare(`UPDATE rooms SET ${field} = ? WHERE id = ?`).bind(on,room.id).run();
    return reply({ok:true});
  }
  if (action === 'end') {
    await db.prepare('UPDATE rooms SET expires_at = ? WHERE id = ?').bind(Date.now(),room.id).run();
    return reply({ok:true,ended:true});
  }
  if (!['approve','reject','kick','ban'].includes(action)) fail(400,'Unknown moderation action.');
  if (typeof data.guestId !== 'string' || !/^[0-9a-f-]{36}$/.test(data.guestId)) fail(400,'Invalid member.');
  const target=await db.prepare('SELECT id, is_host, status FROM guests WHERE id = ? AND room_id = ?')
    .bind(data.guestId,room.id).first();
  if (!target) fail(404,'Member not found.');
  if (target.is_host) fail(403,'The host cannot be removed.');
  if (action === 'approve' && target.status !== 'pending') fail(409,'This person is not waiting for approval.');
  if (action === 'reject') {
    if (target.status !== 'pending') fail(409,'This person is not waiting for approval.');
    await db.prepare("UPDATE guests SET status='kicked' WHERE id = ?").bind(target.id).run();
  } else {
    const status=action === 'approve' ? 'active' : action === 'ban' ? 'banned' : 'kicked';
    await db.prepare('UPDATE guests SET status = ? WHERE id = ?').bind(status,target.id).run();
  }
  return reply({ok:true});
});
