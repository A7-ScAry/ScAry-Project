// ScAry Project — shared server helpers for Cloudflare Pages Functions + D1.
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const MAX_MEMBERS = 50;

export function reply(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS }); }
export function fail(status, message) { const error = new Error(message); error.status = status; throw error; }
export async function run(context, callback) {
  try {
    if (!context.env?.DB) fail(503, 'Database not configured. Bind a D1 database as DB.');
    if (context.request.method !== 'GET' && context.request.method !== 'HEAD') {
      const origin = context.request.headers.get('origin');
      if (origin && origin !== new URL(context.request.url).origin) fail(403, 'Invalid request origin.');
    }
    return await callback();
  } catch (error) {
    const status = error.status >= 400 && error.status < 600 ? error.status : 500;
    if (status === 500) console.error('[ScAry Project]', String(error));
    return reply({ error: status === 500 ? 'Something went wrong. Please try again.' : error.message }, status);
  }
}
export async function payload(request) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > 6000) fail(413, 'Request is too large.');
  const text = await request.text();
  if (text.length > 6000) fail(413, 'Request is too large.');
  try { const value = JSON.parse(text); if (!value || Array.isArray(value) || typeof value !== 'object') throw 0; return value; }
  catch { fail(400, 'Invalid form data.'); }
}
export function cleanText(value, min, max, label) {
  if (typeof value !== 'string') fail(400, `Enter ${label}.`);
  const text = value.trim().replace(/\s+/g, ' ');
  if ([...text].length < min || [...text].length > max || /[\x00-\x1f\x7f]/.test(text)) fail(400, `${label} must be ${min}–${max} characters.`);
  return text;
}
export function nickname(value) {
  const name = cleanText(value, 2, 24, 'Nickname');
  if (!/^[\p{L}\p{N}_. -]+$/u.test(name)) fail(400, 'Nicknames may contain letters, numbers, spaces, dots, hyphens and underscores.');
  return name;
}
export function roomCode(value) {
  const code = String(value || '').trim().toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{10}$/.test(code)) fail(400, 'Invalid room code.');
  return code;
}
export function randomCode(size = 10) {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join('');
}
export function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
export async function sha256(value) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(b), x => x.toString(16).padStart(2, '0')).join('');
}
// WebCrypto PBKDF2 is server-side. Room passwords travel only over HTTPS.
export async function hashPassword(value, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(value), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', iterations: 25000, salt: new TextEncoder().encode(salt) }, key, 256);
  return Array.from(new Uint8Array(bits), x => x.toString(16).padStart(2, '0')).join('');
}
export async function rateLimit(context, action, limit, windowMs) {
  const source = context.request.headers.get('CF-Connecting-IP') || 'development';
  const fingerprint = await sha256(`${source}:${action}`);
  const key = `${action}:${fingerprint}`;
  const now = Date.now(), until = now + windowMs;
  await context.env.DB.prepare(`INSERT INTO rate_limits(key,hits,resets_at) VALUES (?,1,?)
    ON CONFLICT(key) DO UPDATE SET hits = CASE WHEN resets_at <= ? THEN 1 ELSE hits+1 END,
    resets_at = CASE WHEN resets_at <= ? THEN ? ELSE resets_at END`).bind(key,until,now,now,until).run();
  const row = await context.env.DB.prepare('SELECT hits FROM rate_limits WHERE key = ?').bind(key).first();
  if (row && row.hits > limit) fail(429, 'Too many requests. Please try later.');
}
export async function getRoom(db, code) {
  const room = await db.prepare('SELECT * FROM rooms WHERE code = ?').bind(roomCode(code)).first();
  if (!room) fail(404, 'Room not found. Check the invitation link.');
  return room;
}
export function alive(room) { if (room.expires_at <= Date.now()) fail(410, 'This room has expired. Create another room to keep chatting.'); }
export async function getGuest(db, request, room, { allowPending = false, allowInactive = false } = {}) {
  const token = request.headers.get('X-Room-Token') || '';
  if (!/^[0-9a-f]{64}$/.test(token)) fail(401, 'Join this room first.');
  const tokenHash = await sha256(token);
  const guest = await db.prepare('SELECT * FROM guests WHERE room_id = ? AND token_hash = ?').bind(room.id,tokenHash).first();
  if (!guest) fail(401, 'Your room access is no longer valid.');
  if (!allowInactive && guest.status === 'banned') fail(403, 'You have been removed from this room.');
  if (!allowInactive && guest.status === 'kicked') fail(403, 'The host removed you from this room.');
  if (!allowPending && guest.status !== 'active') fail(403, guest.status === 'pending' ? 'Waiting for host approval.' : 'You cannot access this room.');
  return guest;
}
export function hostOnly(guest) { if (!guest.is_host || guest.status !== 'active') fail(403,'Only the room host can do this.'); }
export function publicRoom(room, members = 0) {
  return { code:room.code, title:room.title, expiresAt:room.expires_at, createdAt:room.created_at,
    passwordRequired:!!room.password_hash, approvalRequired:!!room.approval_required,
    locked:!!room.locked, expired:room.expires_at <= Date.now(), memberCount:members };
}
export function publicGuest(guest) { return guest ? { id:guest.id, nickname:guest.nickname, status:guest.status, isHost:!!guest.is_host } : null; }
