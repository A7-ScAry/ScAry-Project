import { run, reply, fail, payload, cleanText, nickname, rateLimit, hashPassword, sha256, randomToken, randomCode } from '../../lib/core.js';

const DAY = 24 * 60 * 60 * 1000;
const durations = { '1h': 60 * 60 * 1000, '1d': DAY, '3d': 3 * DAY, '7d': 7 * DAY, '30d': 30 * DAY, '90d': 90 * DAY };
export const onRequestPost = context => run(context, async () => {
  const db = context.env.DB;
  await rateLimit(context, 'create', 6, 60 * 60 * 1000);
  const data = await payload(context.request);
  const title = cleanText(data.title, 3, 55, 'Room name');
  const name = nickname(data.nickname);
  const duration = durations[data.duration];
  if (!duration) fail(400,'Choose an expiration time.');
  const password = data.password || '';
  if (typeof password !== 'string' || password.length > 64 || (password.length && password.length < 6)) {
    fail(400,'Room password must be 6–64 characters, or left empty.');
  }
  const salt = password ? randomToken().slice(0, 32) : null;
  const hashed = password ? await hashPassword(password, salt) : null;
  const now = Date.now(), id = crypto.randomUUID(), guestId = crypto.randomUUID(), token = randomToken();
  // Expired rooms close immediately; a later room creation opportunistically purges old data.
  await db.prepare('DELETE FROM rooms WHERE expires_at < ?').bind(now - 24 * 60 * 60 * 1000).run();
  await db.prepare('DELETE FROM rate_limits WHERE resets_at < ?').bind(now - 24 * 60 * 60 * 1000).run();
  const tokenHash = await sha256(token);
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = randomCode();
    try {
      await db.batch([
        db.prepare(`INSERT INTO rooms(id,code,title,password_salt,password_hash,approval_required,created_at,expires_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?)`).bind(id,code,title,salt,hashed,data.approvalRequired === true ? 1 : 0,now,now + duration,now),
        db.prepare(`INSERT INTO guests(id,room_id,nickname,nickname_key,token_hash,is_host,status,joined_at)
          VALUES (?,?,?,?,?,1,'active',?)`).bind(guestId,id,name,name.toLocaleLowerCase('en-US'),tokenHash,now)
      ]);
      return reply({ code, token, room: { code, title, expiresAt:now+duration, memberCount:1 }, guest: { id:guestId,nickname:name,status:'active',isHost:true } }, 201);
    } catch (error) {
      if (attempt < 2 && /unique/i.test(String(error))) continue;
      throw error;
    }
  }
  fail(500,'Could not create a unique room.');
});
