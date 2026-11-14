import { run, reply, fail, payload, nickname, getRoom, alive, rateLimit, hashPassword, sha256, randomToken, publicGuest } from '../../../../lib/core.js';

export const onRequestPost = context => run(context, async () => {
  await rateLimit(context,'join',35,60 * 60 * 1000);
  const db = context.env.DB, room = await getRoom(db,context.params.code);
  alive(room);
  if (room.locked) fail(403,'The host has closed this room to new members.');
  const body = await payload(context.request);
  const name = nickname(body.nickname);
  if (room.password_hash) {
    if (typeof body.password !== 'string') fail(401,'This room needs a password.');
    const candidate = await hashPassword(body.password,room.password_salt);
    if (candidate !== room.password_hash) fail(401,'Incorrect room password.');
  }
  const count = await db.prepare("SELECT COUNT(*) AS n FROM guests WHERE room_id = ? AND status IN ('active','pending')").bind(room.id).first();
  if (count.n >= 50) fail(409,'This room is full.');
  const existing = await db.prepare('SELECT status FROM guests WHERE room_id = ? AND nickname_key = ?')
    .bind(room.id,name.toLocaleLowerCase('en-US')).first();
  if (existing) fail(409,'Nickname already used in this room. Choose another.');
  const now = Date.now(), guest = { id:crypto.randomUUID(), nickname:name, status:room.approval_required ? 'pending' : 'active', isHost:false }, token = randomToken();
  await db.prepare(`INSERT INTO guests(id,room_id,nickname,nickname_key,token_hash,is_host,status,joined_at)
    VALUES (?,?,?,?,?,0,?,?)`).bind(guest.id,room.id,name,name.toLocaleLowerCase('en-US'),await sha256(token),guest.status,now).run();
  return reply({ token, guest:publicGuest(guest) },201);
});
