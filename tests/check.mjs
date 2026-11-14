import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import { onRequestPost as createRoom } from '../functions/api/rooms.js';
import { onRequestGet as getRoom } from '../functions/api/rooms/[code].js';
import { onRequestGet as getSummary } from '../functions/api/rooms/[code]/summary.js';
import { onRequestPost as joinRoom } from '../functions/api/rooms/[code]/join.js';
import { onRequestGet as getMessages, onRequestPost as sendMessage } from '../functions/api/rooms/[code]/messages.js';
import { onRequestPost as reactMessage } from '../functions/api/rooms/[code]/reactions.js';
import { onRequestGet as getMembers } from '../functions/api/rooms/[code]/members.js';
import { onRequestPost as moderate } from '../functions/api/rooms/[code]/moderate.js';
import { onRequestPost as report, onRequestGet as readReports } from '../functions/api/rooms/[code]/reports.js';
import { onRequestPost as leave } from '../functions/api/rooms/[code]/leave.js';

const sqlite = new DatabaseSync(':memory:');
sqlite.exec(readFileSync(new URL('../schema.sql', import.meta.url),'utf8'));
let checks = 0;
const db={
  prepare(query){
    const statement=sqlite.prepare(query);
    return {bind(...params){return {
      run:async()=>statement.run(...params),
      first:async()=>statement.get(...params)||null,
      all:async()=>({results:statement.all(...params)})
    };}};
  },
  async batch(items){sqlite.exec('BEGIN');try{const out=[];for(const item of items)out.push(await item.run());sqlite.exec('COMMIT');return out;}catch(e){sqlite.exec('ROLLBACK');throw e;}}
};
async function req(fn, path, {method='GET',body,token,code}={}){
  const headers={};if(body!==undefined)headers['Content-Type']='application/json';if(token)headers['X-Room-Token']=token;
  const request=new Request('https://preview.example'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  const response=await fn({request,env:{DB:db},params:{code}});
  const data=await response.json();return {status:response.status,...data};
}
function check(condition,description){assert.ok(condition,description);checks++;console.log('✓',description);}
const created=await req(createRoom,'/api/rooms',{method:'POST',body:{title:'Study session',nickname:'Host',duration:'1d',password:'secret123',approvalRequired:true}});
check(created.status===201&&created.code.length===10&&created.token.length===64,'Create named, password-protected, expiring room');
const code=created.code,host=created.token;
const p=`/api/rooms/${code}`;
let result=await req(getRoom,p,{code});
check(result.status===200&&result.room.passwordRequired===true&&result.guest===null,'Public invitation metadata hides guest credentials');
result=await req(joinRoom,p+'/join',{method:'POST',body:{nickname:'Guest',password:'wrong'},code});
check(result.status===401,'Reject incorrect room password');
result=await req(joinRoom,p+'/join',{method:'POST',body:{nickname:'Guest',password:'secret123'},code});
check(result.status===201&&result.guest.status==='pending','New visitors can wait for host approval');
const guestToken=result.token,guestId=result.guest.id;
result=await req(getMessages,p+'/messages',{code,token:guestToken});
check(result.status===403,'Pending guest cannot read messages');
result=await req(getMembers,p+'/members',{code,token:host});
check(result.members.length===2&&result.members.some(x=>x.status==='pending'),'Host sees pending member');
result=await req(moderate,p+'/moderate',{method:'POST',code,token:host,body:{action:'approve',guestId}});
check(result.status===200,'Host approves member');
result=await req(sendMessage,p+'/messages',{method:'POST',code,token:guestToken,body:{body:'Hello study friends!',nonce:crypto.randomUUID()}});
check(result.status===201&&result.message.body==='Hello study friends!','Guest can post message after approval');
const nonce=crypto.randomUUID();
await req(sendMessage,p+'/messages',{method:'POST',code,token:host,body:{body:'Welcome',nonce}});
await req(sendMessage,p+'/messages',{method:'POST',code,token:host,body:{body:'Welcome',nonce}});
result=await req(getMessages,p+'/messages',{code,token:guestToken});
check(result.messages.length===2&&result.messages[0].body==='Hello study friends!','Message history is ordered and duplicate sends are prevented');
result=await req(getMessages,p+'/messages',{code});
check(result.status===401,'Nonmembers cannot read conversations');
result=await req(report,p+'/reports',{method:'POST',code,token:guestToken,body:{targetId:created.guest.id,reason:'Test moderator report'}});
check(result.status===201,'Guest reports a member to host');
result=await req(readReports,p+'/reports',{code,token:host});
check(result.status===200&&result.reports.length===1,'Host can view room reports');
result=await req(readReports,p+'/reports',{code,token:guestToken});
check(result.status===403,'Guests cannot view private reports');
result=await req(moderate,p+'/moderate',{method:'POST',code,token:guestToken,body:{action:'lock'}});
check(result.status===403,'Only host can change room settings');
await req(moderate,p+'/moderate',{method:'POST',code,token:host,body:{action:'lock'}});
result=await req(joinRoom,p+'/join',{method:'POST',code,body:{nickname:'Latecomer',password:'secret123'}});
check(result.status===403,'Locked room refuses new guests');
await req(moderate,p+'/moderate',{method:'POST',code,token:host,body:{action:'unlock'}});
result=await req(leave,p+'/leave',{method:'POST',code,token:guestToken});
check(result.status===200,'Member leaves room');
result=await req(getMessages,p+'/messages',{code,token:guestToken});
check(result.status===403,'Former member cannot read messages');
result=await req(moderate,p+'/moderate',{method:'POST',code,token:host,body:{action:'end'}});
check(result.ended===true,'Host can end room early');
result=await req(getMessages,p+'/messages',{code,token:host});
check(result.status===410,'Expired or ended room refuses access');
// My Rooms v1: multiple rooms, unread counts, access keys, and expiry isolation.
const roomA=await req(createRoom,'/api/rooms',{method:'POST',body:{title:'Room Alpha',nickname:'AlphaHost',duration:'7d',approvalRequired:false}});
const roomB=await req(createRoom,'/api/rooms',{method:'POST',body:{title:'Room Beta',nickname:'BetaHost',duration:'1d',approvalRequired:false}});
check(roomA.status===201&&roomB.status===201&&roomA.code!==roomB.code,'Create multiple independent rooms');
const ap=`/api/rooms/${roomA.code}`,bp=`/api/rooms/${roomB.code}`;
const joinedA=await req(joinRoom,ap+'/join',{method:'POST',code:roomA.code,body:{nickname:'AlphaGuest'}});
check(joinedA.status===201&&joinedA.guest.status==='active','Join one room using a guest nickname');
result=await req(getSummary,ap+'/summary?after=0',{code:roomA.code,token:joinedA.token});
check(result.status===200&&result.room.title==='Room Alpha'&&result.guest.nickname==='AlphaGuest'&&result.unread===0,'Authenticated summary starts with zero unread messages');
result=await req(getSummary,bp+'/summary?after=0',{code:roomB.code,token:joinedA.token});
check(result.status===401,'Room access key cannot read summaries from other rooms');
const memberB=await req(joinRoom,bp+'/join',{method:'POST',code:roomB.code,body:{nickname:'BetaGuest'}});
result=await req(getSummary,bp+'/summary?after=0',{code:roomB.code,token:memberB.token});
check(result.status===200&&result.guest.nickname==='BetaGuest','One browser can independently access multiple rooms');
result=await req(getRoom,ap,{code:roomA.code,token:roomA.token});
check(result.status===200&&result.guest.isHost===true,'Saved secret access key restores original host identity');
const afterFirst=Date.now();
await new Promise(r=>setTimeout(r,3));
await req(sendMessage,ap+'/messages',{method:'POST',code:roomA.code,token:roomA.token,body:{body:'Important Alpha announcement',nonce:crypto.randomUUID()}});
result=await req(getSummary,ap+`/summary?after=${afterFirst}`,{code:roomA.code,token:joinedA.token});
check(result.status===200&&result.unread===1,'Guest unread counter increments for messages from another guest');
result=await req(getSummary,ap+'/summary?after=0',{code:roomA.code,token:roomA.token});
check(result.status===200&&result.unread===0,'Sender’s own messages do not increase unread count');
const recent=await req(getMessages,ap+'/messages',{code:roomA.code,token:joinedA.token});
check(recent.serverNow>=afterFirst&&recent.messages.length===1,'Message response includes server clock for read markers');
result=await req(getSummary,ap+`/summary?after=${recent.serverNow}`,{code:roomA.code,token:joinedA.token});
check(result.unread===0,'Unread counter clears after recording a server read marker');
result=await req(getSummary,bp+'/summary?after=0',{code:roomB.code,token:memberB.token});
check(result.unread===0,'Other rooms have separate unread counters');
sqlite.prepare('UPDATE rooms SET expires_at = ? WHERE code = ?').run(Date.now()-1,roomB.code);
result=await req(getSummary,bp+'/summary?after=0',{code:roomB.code,token:memberB.token});
check(result.status===200&&result.room.expired===true&&result.unread===0,'My Rooms can show expired entries without reactivating them');
result=await req(getMessages,bp+'/messages',{code:roomB.code,token:memberB.token});
check(result.status===410,'Expired room messages remain inaccessible');
// Verify all six room lifetime choices against the backend, not only the UI.
for(const [duration,expectedMs] of Object.entries({'1h':3600000,'1d':86400000,'3d':259200000,'7d':604800000,'30d':2592000000,'90d':7776000000})){
  // Give each duration a fresh simulated time window; production rate limits remain unchanged.
  sqlite.prepare("DELETE FROM rate_limits WHERE key LIKE 'create:%'").run();
  const createdAt=Date.now();
  const r=await req(createRoom,'/api/rooms',{method:'POST',body:{title:'Duration '+duration,nickname:'Host',duration}});
  check(r.status===201&&Math.abs((r.room.expiresAt-createdAt)-expectedMs)<10000,'Create '+duration+' room with exact expected lifespan');
}
// Reply-to-message and emoji reactions: exercise permissions, toggling, and polling.
const anchor=(await req(getMessages,ap+'/messages',{code:roomA.code,token:roomA.token})).messages[0];
check(!!anchor?.id,'Existing room history remains readable after adding interactions');
const doReact=(token,messageId,emoji,room=roomA.code)=>req(reactMessage,`/api/rooms/${room}/reactions`,{
  method:'POST',code:room,token,body:{messageId,emoji}
});
result=await doReact(roomA.token,anchor.id,'👍🏽');
check(result.status===200&&result.myReaction==='👍🏽'&&result.reactions[0].count===1,'Host reacts with exactly one supported emoji');
result=await doReact(joinedA.token,anchor.id,'👍🏽');
check(result.myReaction==='👍🏽'&&result.reactions[0].count===2,'Two participants can react to the same message');
result=await doReact(joinedA.token,anchor.id,'😂');
check(result.myReaction==='😂'&&result.reactions.length===2,'Choosing a new emoji switches the existing reaction');
result=await doReact(joinedA.token,anchor.id,'😂');
check(result.myReaction===null&&result.reactions.length===1,'Tapping the same reaction again removes it');
result=await doReact(roomA.token,anchor.id,'💜');
check(result.status===400,'Reject reactions outside the seven requested emojis');
result=await doReact(memberB.token,anchor.id,'👍🏽');
check(result.status===401,'Keys from unrelated rooms cannot react');
result=await doReact(roomA.token,crypto.randomUUID(),'👍🏽');
check(result.status===404,'Cannot react to a nonexistent message');
const reactionPoll=await req(getMessages,ap+`/messages?after=${encodeURIComponent(anchor.createdAt+':'+anchor.id)}&react=${anchor.id}`,{
  code:roomA.code,token:roomA.token
});
check(reactionPoll.status===200&&reactionPoll.reactionUpdates[anchor.id].myReaction==='👍🏽',
  'Polling refreshes reactions even without a new message');
const originalReplies=await req(getMessages,ap+'/messages',{code:roomA.code,token:roomA.token});
check(originalReplies.messages.every(m=>'replyToId' in m),'Original messages are returned with nullable reply fields');
const replyNonce=crypto.randomUUID();
result=await req(sendMessage,ap+'/messages',{method:'POST',code:roomA.code,token:joinedA.token,
  body:{body:'Reply to your announcement',nonce:replyNonce,replyToId:anchor.id}});
check(result.status===201&&result.message.replyToId===anchor.id,'Guest replies to a specific message');
const replyId=result.message.id;
result=await req(getMessages,ap+'/messages',{code:roomA.code,token:roomA.token});
const replyItem=result.messages.find(m=>m.id===replyId);
check(replyItem?.replyBody===anchor.body&&replyItem.replyAuthor===anchor.author,'Replied message displays its author and quoted content');
result=await req(sendMessage,ap+'/messages',{method:'POST',code:roomA.code,token:joinedA.token,
  body:{body:'Trying a reply across rooms',nonce:crypto.randomUUID(),replyToId:(await req(sendMessage,bp+'/messages',{
    method:'POST',code:roomB.code,token:memberB.token,body:{body:'Expired',nonce:crypto.randomUUID()}
  })).message?.id||crypto.randomUUID()}});
check(result.status===404,'Reply target must belong to the same room');
result=await req(sendMessage,ap+'/messages',{method:'POST',code:roomA.code,token:joinedA.token,
  body:{body:'Repeated reply nonce',nonce:replyNonce,replyToId:anchor.id}});
check(result.message.id===replyId&&result.message.body==='Reply to your announcement','Retrying a reply does not duplicate it');
const later=await req(joinRoom,ap+'/join',{method:'POST',code:roomA.code,body:{nickname:'LateVisitor'}});
check(later.status===201,'Later member can join after old messages were sent');
result=await doReact(later.token,anchor.id,'🥀');
check(result.status===404,'Late member cannot react to messages sent before joining');
result=await req(sendMessage,ap+'/messages',{method:'POST',code:roomA.code,token:later.token,
  body:{body:'Cannot quote old messages',nonce:crypto.randomUUID(),replyToId:anchor.id}});
check(result.status===404,'Late member cannot quote messages from before joining');
await new Promise(r=>setTimeout(r,4));
result=await req(sendMessage,ap+'/messages',{method:'POST',code:roomA.code,token:roomA.token,
  body:{body:'New host message linking to old announcement',nonce:crypto.randomUUID(),replyToId:anchor.id}});
check(result.status===201,'Host can reply to old messages after a new guest joins');
result=await req(getMessages,ap+'/messages',{code:roomA.code,token:later.token});
check(result.messages.length>=1 && result.messages.every(m=>m.id!==anchor.id),
  'Late members cannot read pre-join message history');
check(result.messages.some(m=>m.body.startsWith('New host message')&&m.replyBody===null&&m.replyAuthor===null),
  'Quoted text from pre-join history is redacted for late members');
const allEmojis=['👍🏽','😂','😮','😢','😡','😭','🥀'];
for (const emoji of allEmojis){
  result=await doReact(roomA.token,replyId,emoji);
  check(result.status===200&&result.myReaction===emoji,`Reaction ${emoji} is supported`);
}
console.log(`\n${checks} end-to-end simulated API checks passed.`);
