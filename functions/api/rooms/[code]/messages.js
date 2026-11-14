import { run, reply, fail, payload, getRoom, alive, getGuest, rateLimit } from '../../../../lib/core.js';
import { validMessageId, MESSAGE_ID, reactionSummaries } from '../../../../lib/interactions.js';

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
  const visibleSince=guest.is_host ? 0 : guest.joined_at;
  const args=[visibleSince,visibleSince,room.id,visibleSince];
  if (parsed) args.push(Number(parsed[1]),Number(parsed[1]),parsed[2]);
  const rows=await db.prepare(`SELECT m.id,m.body,m.created_at AS createdAt,
     g.nickname AS author,g.id AS guestId,m.reply_to_id AS replyToId,
     CASE WHEN parent.created_at >= ? THEN parent.body ELSE NULL END AS replyBody,
     CASE WHEN parent.created_at >= ? THEN pg.nickname ELSE NULL END AS replyAuthor
     FROM messages m JOIN guests g ON g.id=m.guest_id
     LEFT JOIN messages parent ON parent.id=m.reply_to_id AND parent.room_id=m.room_id
     LEFT JOIN guests pg ON pg.id=parent.guest_id
     WHERE m.room_id=? AND m.created_at>=? ${extra}
     ORDER BY m.created_at ${direction},m.id ${direction} LIMIT 51`).bind(...args).all();
  const result=rows.results || [];
  const hasMore=!after && result.length > 50;
  if (result.length > 50) result.pop();
  if (!after) result.reverse();
  // Polling refreshes reactions on existing messages as well as getting new messages.
  const react=url.searchParams.get('react') || '';
  if (react.length > 1480) fail(400,'Too many reaction updates requested.');
  const refreshIds=react ? react.split(',').filter(Boolean) : [];
  if (refreshIds.length>40 || refreshIds.some(id=>!MESSAGE_ID.test(id))) fail(400,'Invalid reaction refresh IDs.');
  const summaries=await reactionSummaries(db,room,guest,[...result.map(m=>m.id),...refreshIds]);
  for (const msg of result) Object.assign(msg,summaries[msg.id] || {reactions:[],myReaction:null});
  const reactionUpdates=Object.fromEntries(refreshIds.map(id=>[id,summaries[id] || {reactions:[],myReaction:null}]));
  return reply({messages:result,hasMore,reactionUpdates,serverNow:Date.now()});
});

export const onRequestPost = context => run(context, async () => {
  const db=context.env.DB,room=await getRoom(db,context.params.code);
  alive(room);
  const guest=await getGuest(db,context.request,room);
  await rateLimit(context,`message:${room.id}:${guest.id}`,60,60*1000);
  const input=await payload(context.request);
  const body=typeof input.body === 'string' ? input.body.trim() : '';
  if (!body || [...body].length>1200 || /[\x00-\x08\x0b\x0e-\x1f\x7f]/.test(body)) fail(400,'Message must be 1–1200 characters.');
  const nonce=input.nonce;
  if (typeof nonce !== 'string' || !/^[0-9a-f-]{36}$/.test(nonce)) fail(400,'Invalid message ID.');
  let replyToId=null;
  if (input.replyToId !== undefined && input.replyToId !== null && input.replyToId !== '') {
    replyToId=validMessageId(input.replyToId);
    const target=await db.prepare('SELECT id FROM messages WHERE id = ? AND room_id = ? AND created_at >= ?')
      .bind(replyToId,room.id,guest.is_host ? 0 : guest.joined_at).first();
    if (!target) fail(404,'The replied-to message is unavailable in your room history.');
  }
  const now=Date.now(),id=crypto.randomUUID();
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO messages(id,room_id,guest_id,client_nonce,reply_to_id,body,created_at) VALUES (?,?,?,?,?,?,?)')
      .bind(id,room.id,guest.id,nonce,replyToId,body,now),
    db.prepare('UPDATE rooms SET updated_at=? WHERE id=? AND updated_at<=?').bind(now,room.id,now)
  ]);
  const saved=await db.prepare(`SELECT m.id,m.body,m.created_at AS createdAt,m.reply_to_id AS replyToId,
    parent.body AS replyBody,pg.nickname AS replyAuthor
    FROM messages m LEFT JOIN messages parent ON parent.id=m.reply_to_id
    LEFT JOIN guests pg ON pg.id=parent.guest_id
    WHERE m.room_id=? AND m.guest_id=? AND m.client_nonce=?`)
    .bind(room.id,guest.id,nonce).first();
  return reply({message:{...saved,author:guest.nickname,guestId:guest.id,reactions:[],myReaction:null}},201);
});
