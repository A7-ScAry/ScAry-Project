import { run, reply } from '../../lib/core.js';
export const onRequestGet = context => run(context, async () => {
  const result=await context.env.DB.prepare('SELECT 1 AS ok').first();
  return reply({ ok:result?.ok===1, project:'ScAry Project' });
});
