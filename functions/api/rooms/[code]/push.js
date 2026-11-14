import { run, reply, fail, payload, getRoom, alive, getGuest, sha256, rateLimit } from '../../../../lib/core.js';
import { checkSubscription, permittedEndpoint } from '../../../../lib/webpush.js';

// A registration belongs to one room, one authenticated guest and one device endpoint.
export const onRequestPost = context => run(context, async () => {
  const db=context.env.DB, room=await getRoom(db,context.params.code);
  alive(room);
  const guest=await getGuest(db,context.request,room);
  await rateLimit(context,'push-subscription:'+room.id+':'+guest.id,30,60*60*1000);
  const data=await payload(context.request),action=data.action;
  if(!['subscribe','unsubscribe','preferences'].includes(action))fail(400,'Unknown notification action.');
  const endpoint=data.subscription?.endpoint||data.endpoint;
  if(!permittedEndpoint(endpoint))fail(400,'Unsupported push service.');
  const endpointHash=await sha256(endpoint);
  if(action==='unsubscribe') {
    await db.prepare('DELETE FROM push_subscriptions WHERE room_id=? AND guest_id=? AND endpoint_hash=?')
      .bind(room.id,guest.id,endpointHash).run();
    return reply({ok:true});
  }
  if(typeof data.muted!=='boolean'||typeof data.previewEnabled!=='boolean')fail(400,'Invalid notification preferences.');
  if(action==='preferences'){
    const result=await db.prepare(`UPDATE push_subscriptions SET muted=?,preview_enabled=?,updated_at=?
      WHERE room_id=? AND guest_id=? AND endpoint_hash=?`).bind(data.muted?1:0,data.previewEnabled?1:0,Date.now(),room.id,guest.id,endpointHash).run();
    if(!(result.meta?.changes ?? result.changes))fail(404,'Enable notifications on this device first.');
    return reply({ok:true,muted:data.muted,previewEnabled:data.previewEnabled});
  }
  if(!(context.env.VAPID_PUBLIC_KEY && context.env.VAPID_PRIVATE_KEY && context.env.VAPID_SUBJECT))
    fail(503,'Notifications are not configured on this website yet.');
  let sub;
  try{sub=checkSubscription(data.subscription);}catch(error){fail(400,error.message);}
  const now=Date.now();
  await db.prepare(`INSERT INTO push_subscriptions(id,room_id,guest_id,endpoint_hash,endpoint,p256dh,auth,muted,preview_enabled,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(room_id,guest_id,endpoint_hash) DO UPDATE SET
    p256dh=excluded.p256dh,auth=excluded.auth,muted=excluded.muted,
    preview_enabled=excluded.preview_enabled,updated_at=excluded.updated_at`)
    .bind(crypto.randomUUID(),room.id,guest.id,endpointHash,sub.endpoint,sub.p256dh,sub.auth,
      data.muted?1:0,data.previewEnabled?1:0,now,now).run();
  // Avoid uncontrolled accumulation of stale device registrations per guest.
  await db.prepare(`DELETE FROM push_subscriptions WHERE id IN (
    SELECT id FROM push_subscriptions WHERE room_id=? AND guest_id=?
    ORDER BY updated_at DESC LIMIT -1 OFFSET 6
  )`).bind(room.id,guest.id).run();
  return reply({ok:true,muted:data.muted,previewEnabled:data.previewEnabled});
});
