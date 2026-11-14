// ScAry Project Web Push (RFC 8291 + RFC 8292). No external services or npm packages.
// Push endpoints are validated to prevent arbitrary outbound requests (SSRF).
const enc = new TextEncoder();
const keyInfo = enc.encode('WebPush: info\0');
const cekInfo = enc.encode('Content-Encoding: aes128gcm\0');
const nonceInfo = enc.encode('Content-Encoding: nonce\0');
const asBytes = input => input instanceof Uint8Array ? input : new Uint8Array(input);
const concat = (...parts) => {
  const items=parts.map(asBytes), data=new Uint8Array(items.reduce((n,p)=>n+p.length,0));
  let position=0;for(const p of items){data.set(p,position);position+=p.length;}
  return data;
};
export function decode64(value) {
  if(typeof value!=='string'||!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid base64url value.');
  const raw=atob(value.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-value.length%4)%4));
  return Uint8Array.from(raw, x=>x.charCodeAt(0));
}
export function encode64(bytes) {return btoa(String.fromCharCode(...asBytes(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');}
const base64JSON = value => encode64(enc.encode(JSON.stringify(value)));
function ensureKeyLength(s,n){const result=decode64(s);if(result.length!==n)throw new Error('Invalid Web Push key length.');return result;}
export function permittedEndpoint(endpoint) {
  if(typeof endpoint!=='string'||endpoint.length>900||!endpoint.startsWith('https://'))return false;
  let url;try{url=new URL(endpoint);}catch{return false;}
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash)return false;
  const host=url.hostname.toLowerCase();
  // Known Web Push relays for Chrome/Firefox/Safari/Edge. Reject untrusted URLs.
  return host==='fcm.googleapis.com'||host==='updates.push.services.mozilla.com'||
    host==='web.push.apple.com'||host==='push.apple.com'||
    (host.endsWith('.notify.windows.com') && host.length<80)||
    host==='wns.notify.windows.com';
}
export function checkSubscription(subscription) {
  const {endpoint,keys}=subscription||{};
  if(!permittedEndpoint(endpoint))throw new Error('Unsupported push provider or endpoint.');
  if(!keys || typeof keys!=='object')throw new Error('Missing subscription encryption keys.');
  ensureKeyLength(keys.p256dh,65);ensureKeyLength(keys.auth,16);
  if(decode64(keys.p256dh)[0]!==4)throw new Error('Malformed subscription public key.');
  return {endpoint,p256dh:keys.p256dh,auth:keys.auth};
}
async function hmac(key,data){const k=await crypto.subtle.importKey('raw',asBytes(key),{name:'HMAC',hash:'SHA-256'},false,['sign']);return new Uint8Array(await crypto.subtle.sign('HMAC',k,asBytes(data)));}
async function hkdfExpand(prk,info,length){if(length>32)throw new Error('Only one HKDF block supported');return (await hmac(prk,concat(info,new Uint8Array([1])))).slice(0,length);}
export async function encryptPush(payload,recipientPublic,authSecret) {
  const receiverPublic=ensureKeyLength(recipientPublic,65),auth=ensureKeyLength(authSecret,16);
  const pub=await crypto.subtle.importKey('raw',receiverPublic,{name:'ECDH',namedCurve:'P-256'},false,[]);
  const sender=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
  const senderPublic=new Uint8Array(await crypto.subtle.exportKey('raw',sender.publicKey));
  const secret=new Uint8Array(await crypto.subtle.deriveBits({name:'ECDH',public:pub},sender.privateKey,256));
  const prkKey=await hmac(auth,secret);
  const ikm=await hkdfExpand(prkKey,concat(keyInfo,receiverPublic,senderPublic),32);
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const prk=await hmac(salt,ikm);
  const cek=await hkdfExpand(prk,cekInfo,16),nonce=await hkdfExpand(prk,nonceInfo,12);
  const json=enc.encode(JSON.stringify(payload));
  if(json.length>2500)throw new Error('Notification payload is too large.');
  const text=concat(json,new Uint8Array([2]));
  const aesKey=await crypto.subtle.importKey('raw',cek,'AES-GCM',false,['encrypt']);
  const ciphertext=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce,tagLength:128},aesKey,text));
  // RFC 8188: salt(16), record size(4), key-id length(1), ECDH server public(65), ciphertext.
  return concat(salt,new Uint8Array([0,0,16,0,65]),senderPublic,ciphertext);
}
export async function vapidAuthorization(endpoint,publicKey,privateKey,contact) {
  if(!permittedEndpoint(endpoint))throw new Error('Unsupported push endpoint.');
  const publicRaw=ensureKeyLength(publicKey,65),secret=ensureKeyLength(privateKey,32);
  if(publicRaw[0]!==4)throw new Error('VAPID public key must be a P-256 point.');
  if(!/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact||''))throw new Error('Configure VAPID_SUBJECT as a mailto: email address.');
  const jwk={kty:'EC',crv:'P-256',x:encode64(publicRaw.slice(1,33)),y:encode64(publicRaw.slice(33,65)),d:encode64(secret),ext:false};
  const key=await crypto.subtle.importKey('jwk',jwk,{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
  const token=base64JSON({typ:'JWT',alg:'ES256'})+'.'+base64JSON({aud:new URL(endpoint).origin,exp:Math.floor(Date.now()/1000)+3600,sub:contact});
  const signature=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,enc.encode(token));
  return 'vapid t='+token+'.'+encode64(new Uint8Array(signature))+', k='+publicKey;
}
export async function sendWebPush(env, subscription, notification, fetcher=fetch) {
  const {endpoint,p256dh,auth}=checkSubscription({endpoint:subscription.endpoint,keys:{p256dh:subscription.p256dh,auth:subscription.auth}});
  const body=await encryptPush(notification,p256dh,auth);
  const authorization=await vapidAuthorization(endpoint,env.VAPID_PUBLIC_KEY,env.VAPID_PRIVATE_KEY,env.VAPID_SUBJECT);
  const response=await fetcher(endpoint,{method:'POST',headers:{Authorization:authorization,TTL:'3600',Urgency:'normal','Content-Encoding':'aes128gcm','Content-Type':'application/octet-stream'},body});
  return response.status;
}

// Fire-and-forget in Cloudflare request waitUntil; failures never block sending a chat message.
export async function notifyRoomOfMessage(context,room,author,message,replyToId=null) {
  const env=context.env;
  if(!env.VAPID_PUBLIC_KEY||!env.VAPID_PRIVATE_KEY||!env.VAPID_SUBJECT)return;
  try {
    const replyRecipient=replyToId ? await env.DB.prepare('SELECT guest_id FROM messages WHERE id=? AND room_id=?').bind(replyToId,room.id).first() : null;
    const subscribers=await env.DB.prepare(`SELECT ps.id,ps.endpoint,ps.p256dh,ps.auth,ps.preview_enabled AS previewEnabled,
      ps.guest_id AS guestId FROM push_subscriptions ps JOIN guests g ON g.id=ps.guest_id
      WHERE ps.room_id=? AND g.status='active' AND ps.guest_id != ? AND ps.muted=0
      ORDER BY ps.updated_at DESC LIMIT 90`).bind(room.id,author.id).all();
    const rows=subscribers.results||[];
    const safeUrl='/?room='+encodeURIComponent(room.code);
    // Keep private messages out of lock-screen notifications unless the recipient opted in.
    await Promise.allSettled(rows.map(async sub=>{
      try {
        const direct=replyRecipient?.guest_id===sub.guestId;
        const notification={title:sub.previewEnabled ? room.title : 'ScAry Project',
          body:sub.previewEnabled ? (author.nickname+(direct?' replied: ':': ')+message.body.slice(0,90))
            : direct?'Someone replied to your message.':'New message in one of your rooms.',
          url:safeUrl,kind:direct?'reply':'message',roomCode:room.code};
        const status=await sendWebPush(env,sub,notification);
        if(status===404||status===410)await env.DB.prepare('DELETE FROM push_subscriptions WHERE id=?').bind(sub.id).run();
        else if(status<200||status>=300)console.warn('[ScAry Push] Delivery rejected:',status);
      }catch(error){console.warn('[ScAry Push] Delivery failed:',String(error).slice(0,120));}
    }));
  }catch(error){console.warn('[ScAry Push] Dispatch failed:',String(error).slice(0,120));}
}
