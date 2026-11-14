import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {generateKeyPairSync} from 'node:crypto';
import {onRequestPost as createRoom} from '../functions/api/rooms.js';
import {onRequestPost as joinRoom} from '../functions/api/rooms/[code]/join.js';
import {onRequestPost as sendMessage} from '../functions/api/rooms/[code]/messages.js';
import {onRequestPost as settings} from '../functions/api/rooms/[code]/push.js';
import {onRequestGet as config} from '../functions/api/push/config.js';
import {encryptPush,vapidAuthorization,encode64,decode64,permittedEndpoint} from '../lib/webpush.js';
const assertOk=(test,name)=>{assert.ok(test,name);console.log('✓ '+name);};
const sqlite=new DatabaseSync(':memory:');
sqlite.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));
const db={prepare(q){const s=sqlite.prepare(q);return {bind(...args){return {first:async()=>s.get(...args)||null,all:async()=>({results:s.all(...args)}),run:async()=>s.run(...args)}}}},async batch(q){sqlite.exec('BEGIN');try{const result=[];for(const p of q)result.push(await p.run());sqlite.exec('COMMIT');return result;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
const key=generateKeyPairSync('ec',{namedCurve:'prime256v1'}).privateKey.export({format:'jwk'});
const vapidPublic=encode64(new Uint8Array([4,...decode64(key.x),...decode64(key.y)]));
const env={DB:db,VAPID_PUBLIC_KEY:vapidPublic,VAPID_PRIVATE_KEY:key.d,VAPID_SUBJECT:'mailto:test@example.com'};
const device=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
const uaPub=new Uint8Array(await crypto.subtle.exportKey('raw',device.publicKey));
const auth=crypto.getRandomValues(new Uint8Array(16)),url='https://fcm.googleapis.com/fcm/send/test';
const subscription={endpoint:url,keys:{p256dh:encode64(uaPub),auth:encode64(auth)}};
const enc=new TextEncoder(),dec=new TextDecoder();
const concat=(...parts)=>{const v=new Uint8Array(parts.reduce((n,a)=>n+a.length,0));let i=0;for(const p of parts){v.set(p,i);i+=p.length;}return v;};
async function hmac(key,data){const k=await crypto.subtle.importKey('raw',key,{name:'HMAC',hash:'SHA-256'},false,['sign']);return new Uint8Array(await crypto.subtle.sign('HMAC',k,data));}
async function expand(key,info,length){return (await hmac(key,concat(info,new Uint8Array([1])))).slice(0,length);}
async function decrypt(bytes){
  const salt=bytes.slice(0,16),pub=bytes.slice(21,86),payload=bytes.slice(86);
  assert.equal(new DataView(bytes.buffer,bytes.byteOffset+16,4).getUint32(0),4096);
  const serverKey=await crypto.subtle.importKey('raw',pub,{name:'ECDH',namedCurve:'P-256'},false,[]);
  const shared=new Uint8Array(await crypto.subtle.deriveBits({name:'ECDH',public:serverKey},device.privateKey,256));
  const prk=await hmac(auth,shared);
  const ikm=await expand(prk,concat(enc.encode('WebPush: info\0'),uaPub,pub),32);
  const key=await hmac(salt,ikm);
  const cek=await expand(key,enc.encode('Content-Encoding: aes128gcm\0'),16);
  const nonce=await expand(key,enc.encode('Content-Encoding: nonce\0'),12);
  const aes=await crypto.subtle.importKey('raw',cek,{name:'AES-GCM'},false,['decrypt']);
  const clear=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:nonce},aes,payload));
  assert.equal(clear.at(-1),2);
  return JSON.parse(dec.decode(clear.slice(0,-1)));
}
const sample={title:'ScAry Project',body:'New message',kind:'message',url:'/?room=ABCD234567'};
assert.deepEqual(await decrypt(await encryptPush(sample,subscription.keys.p256dh,subscription.keys.auth)),sample);
assertOk(true,'Encrypted Web Push decrypts with recipient keys');
const jwt=(await vapidAuthorization(url,vapidPublic,key.d,env.VAPID_SUBJECT)).slice(8).split(', k=')[0].split('.');
const verifyKey=await crypto.subtle.importKey('raw',decode64(vapidPublic),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
assertOk(await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},verifyKey,decode64(jwt[2]),enc.encode(jwt.slice(0,2).join('.'))),'VAPID JWT signature verifies');
assertOk(!permittedEndpoint('https://127.0.0.1/')&&!permittedEndpoint('https://attacker.example/')&&permittedEndpoint(url),'Reject arbitrary push URLs');
const pending=[],pushes=[],originalFetch=globalThis.fetch;
globalThis.fetch=async(endpoint,options)=>{assert.equal(endpoint,url);pushes.push(await decrypt(options.body));return new Response(null,{status:201});};
async function req(fn,path,{token,code,method='GET',body,wait=false}={}){
 const request=new Request('https://scaryproject.pages.dev'+path,{method,headers:token?{'X-Room-Token':token}:{},body:body===undefined?undefined:JSON.stringify(body)});
 const response=await fn({request,env,params:{code},...(wait?{waitUntil:p=>pending.push(p)}:{})});
 return {status:response.status,...await response.json()};
}
try{
 assertOk((await req(config,'/api/push/config')).publicKey===vapidPublic,'Only public VAPID key reaches the browser');
 const host=await req(createRoom,'/api/rooms',{method:'POST',body:{title:'Push test room',nickname:'Host',duration:'1d'}});
 const code=host.code,recipient=await req(joinRoom,`/api/rooms/${host.code}/join`,{method:'POST',code,body:{nickname:'Friend'}});
 const route=`/api/rooms/${code}/push`;
 let response=await req(settings,route,{method:'POST',code,token:recipient.token,body:{action:'subscribe',subscription,muted:false,previewEnabled:false}});
 assertOk(response.status===200,'Authorized guest registers for push');
 response=await req(settings,route,{method:'POST',code,token:'f'.repeat(64),body:{action:'subscribe',subscription,muted:false,previewEnabled:false}});
 assertOk(response.status===401,'Invalid guest cannot subscribe');
 response=await req(sendMessage,`/api/rooms/${code}/messages`,{method:'POST',code,token:host.token,body:{body:'Hello',nonce:crypto.randomUUID()},wait:true});
 await Promise.allSettled(pending.splice(0));
 assertOk(response.status===201&&pushes.length===1&&pushes[0].body==='New message in one of your rooms.','New message pushes private default body');
 response=await req(settings,route,{method:'POST',code,token:recipient.token,body:{action:'preferences',endpoint:url,muted:true,previewEnabled:false}});
 assertOk(response.status===200,'Guest can mute room');
 await req(sendMessage,`/api/rooms/${code}/messages`,{method:'POST',code,token:host.token,body:{body:'Muted',nonce:crypto.randomUUID()},wait:true});
 await Promise.allSettled(pending.splice(0));
 assertOk(pushes.length===1,'Muted room sends no push');
 response=await req(settings,route,{method:'POST',code,token:recipient.token,body:{action:'unsubscribe',endpoint:url}});
 assertOk(response.status===200&&sqlite.prepare('SELECT count(*) n FROM push_subscriptions').get().n===0,'Unsubscribe removes subscription');
 console.log('Notification push tests passed.');
}finally{globalThis.fetch=originalFetch;}
