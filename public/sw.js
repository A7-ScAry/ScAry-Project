/* ScAry Project background push notifications. Does not cache or intercept chat requests. */
'use strict';
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('push',event=>{
  let data={};
  try {data=event.data?.json()||{};}catch{}
  const url=typeof data.url==='string' && /^\/\?room=[A-HJ-NP-Z2-9]{10}$/.test(data.url) ? data.url : '/';
  const title=typeof data.title==='string' ? data.title.slice(0,75) : 'ScAry Project';
  const body=typeof data.body==='string' ? data.body.slice(0,180) : 'A room has a new message.';
  event.waitUntil(self.registration.showNotification(title,{
    body,icon:'/icon.svg',badge:'/icon.svg',
    tag:'scary-'+(data.kind==='reply'?'reply-':'message-')+(data.roomCode||'room'),
    renotify:false,data:{url},
  }));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const target=new URL(event.notification.data?.url||'/',self.location.origin);
  if(target.origin!==self.location.origin)return;
  event.waitUntil((async()=>{
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const match=windows.find(client=>new URL(client.url).origin===target.origin);
    if(match){await match.navigate(target.href);return match.focus();}
    return self.clients.openWindow(target.href);
  })());
});
