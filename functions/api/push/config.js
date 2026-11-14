import { run, reply } from '../../../lib/core.js';
export const onRequestGet = context => run(context, async () => {
  const env=context.env;
  const configured=!!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
  return reply({configured,publicKey:configured?env.VAPID_PUBLIC_KEY:null});
});
