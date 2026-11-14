import { run, reply, fail, getRoom, alive, getGuest } from '../../../../lib/core.js';
export const onRequestPost = context => run(context, async () => {
  const db=context.env.DB,room=await getRoom(db,context.params.code);
  alive(room);
  const guest=await getGuest(db,context.request,room);
  if(guest.is_host) fail(403,'Hosts must end the room instead of leaving it unattended.');
  await db.prepare("UPDATE guests SET status = 'left' WHERE id = ?").bind(guest.id).run();
  return reply({ok:true});
});
