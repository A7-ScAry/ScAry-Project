import { run, reply, fail, payload, getRoom, alive, getGuest, hostOnly, rateLimit, cleanText } from '../../../../lib/core.js';

export const onRequestPost = context => run(context, async () => {
  const db=context.env.DB, room=await getRoom(db,context.params.code);
  alive(room);
  const guest=await getGuest(db,context.request,room);
  await rateLimit(context,`report:${room.id}:${guest.id}`,8,60*60*1000);
  const input=await payload(context.request);
  if(typeof input.targetId !== 'string' || !/^[0-9a-f-]{36}$/.test(input.targetId)) fail(400,'Select a person to report.');
  if(input.targetId === guest.id) fail(400,'You cannot report yourself.');
  const target=await db.prepare('SELECT id FROM guests WHERE id=? AND room_id=?').bind(input.targetId,room.id).first();
  if(!target) fail(404,'Person not found.');
  const reason=cleanText(input.reason,5,250,'Report reason');
  await db.prepare('INSERT INTO reports(id,room_id,reporter_id,target_id,reason,created_at) VALUES (?,?,?,?,?,?)')
    .bind(crypto.randomUUID(),room.id,guest.id,target.id,reason,Date.now()).run();
  return reply({ok:true,notice:'Report sent to this room’s host.'},201);
});

export const onRequestGet = context => run(context, async () => {
  const db=context.env.DB,room=await getRoom(db,context.params.code);
  alive(room);
  const guest=await getGuest(db,context.request,room);
  hostOnly(guest);
  const results=await db.prepare(`SELECT r.id, r.reason, r.created_at AS createdAt,
    a.nickname AS reporter, b.nickname AS target FROM reports r
    JOIN guests a ON a.id = r.reporter_id
    JOIN guests b ON b.id = r.target_id
    WHERE r.room_id = ? ORDER BY r.created_at DESC LIMIT 50`).bind(room.id).all();
  return reply({ reports:results.results || [] });
});
