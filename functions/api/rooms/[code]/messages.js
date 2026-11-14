import { run, reply, fail, payload, getRoom, alive, getGuest, rateLimit } from '../../../../lib/core.js';

export const onRequestGet = context => run(context, async () => {
  const db=context.env.DB, room=await getRoom(db,context.params.code);
  alive(room);
  const guest=await getGuest(db,context.request,room);
  const url=new URL(context.request.url);
  const before=url.searchParams.get('before');
  const after=url.searchParams.get('after');
  if (before && after) fail(400,'Choose one message cursor.');
  const cursor=before || after;
  const parsed=cursor && /^(\d{13}):([0-9a-f-]{36})$/.exec(cursor);
  if (cursor && !parsed) fail(400,'Invalid message cursor.');
  const extra=!parsed ? '' : before
    ? 'AND (m.created_at < ? OR (m.created_at = ? AND m.id < ?))'
    : 'AND (m.created_at > ? OR (m.created_at = ? AND m.id > ?))';
  const direction=after ? 'ASC' : 'DESC';
  const args=[room.id, guest.is_host ? 0 : guest.joined_at];
  if (parsed) args.push(Number(parsed[1]),Number(parsed[1]),parsed[2]);
  const rows=await db.prepare(`SELECT m.id, m.body, m.created_at AS createdAt,
     g.nickname AS author, g.id AS guestId
     FROM messages m JOIN guests g ON g.id = m.guest_id
     WHERE m.room_id = ? AND m.created_at >= ? ${extra}
     ORDER BY m.created_at ${direction}, m.id ${direction} LIMIT 51`).bind(...args).all();
  const result=rows.results || [];
  const hasMore=!after && result.length > 50;
  if (result.length > 50) result.pop();
  if (!after) result.reverse();
  return reply({ messages:result, hasMore, serverNow:Date.now() });
});

export const onRequestPost = context => run(context, async () => {
  const db=context.env.DB,room=await getRoom(db,context.params.code);
  alive(room);
  const guest=await getGuest(db,context.request,room);
  await rateLimit(context,`message:${room.id}:${guest.id}`,60,60 * 1000);
  const input=await payload(context.request);
  const body=typeof input.body === 'string' ? input.body.trim() : '';
  if (!body || [...body].length > 1200 || /[\x00-\x08\x0b\x0e-\x1f\x7f]/.test(body)) fail(400,'Message must be 1–1200 characters.');
  const nonce=input.nonce;
  if (typeof nonce !== 'string' || !/^[0-9a-f-]{36}$/.test(nonce)) fail(400,'Invalid message ID.');
  const now=Date.now(),id=crypto.randomUUID();
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO messages(id,room_id,guest_id,client_nonce,body,created_at) VALUES (?,?,?,?,?,?)')
      .bind(id,room.id,guest.id,nonce,body,now),
    db.prepare('UPDATE rooms SET updated_at = ? WHERE id = ? AND updated_at <= ?').bind(now,room.id,now)
  ]);
  const saved=await db.prepare('SELECT id, body, created_at AS createdAt FROM messages WHERE room_id = ? AND guest_id = ? AND client_nonce = ?')
    .bind(room.id,guest.id,nonce).first();
  return reply({ message:{...saved,author:guest.nickname,guestId:guest.id} },201);
});
