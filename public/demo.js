/* Local, simulated preview backend. Never used for real messages or invitations. */
'use strict';
(() => {
  const KEY='scary_project_preview_rooms_v1';
  let memoryRooms={};
  function load(){try{return JSON.parse(localStorage.getItem(KEY)||JSON.stringify(memoryRooms));}catch{return memoryRooms;}}
  function save(rooms){memoryRooms=rooms;try{localStorage.setItem(KEY,JSON.stringify(rooms));}catch{}}
  function fail(status,message){const e=new Error(message);e.status=status;throw e;}
  function uid(){return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(16).slice(2).padEnd(36,'a');}
  function token(){return Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');}
  function code(){const a='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';return Array.from({length:10},()=>a[Math.floor(Math.random()*a.length)]).join('');}
  function safeRoom(room){return {code:room.code,title:room.title,expiresAt:room.expiresAt,createdAt:room.createdAt,
    passwordRequired:!!room.password,approvalRequired:room.approvalRequired,locked:room.locked,
    expired:room.expiresAt<=Date.now(),memberCount:room.guests.filter(x=>x.status==='active').length};}
  function publicGuest(g){return g&&{id:g.id,nickname:g.nickname,status:g.status,isHost:g.isHost};}
  window.scaryDemoAPI=async(url,{method='GET',body=null,token:authToken=null}={})=>{
    await new Promise(resolve=>setTimeout(resolve,180));
    const rooms=load();
    const u=new URL(url,'https://preview.invalid');
    const segments=u.pathname.split('/').filter(Boolean);
    if(u.pathname==='/api/rooms' && method==='POST'){
      const n=String(body?.nickname||'').trim(),title=String(body?.title||'').trim();
      if(title.length<3||n.length<2)fail(400,'Add a room name and nickname.');
      let c=code();while(rooms[c])c=code();const now=Date.now();
      const host={id:uid(),nickname:n,status:'active',isHost:true,token:token(),joinedAt:now};
      const guestNames=title==='University Project'?['Ayaan','Mehr','Rafi','Mira','Nabila','Arman','Sana']
        : title==='Gaming Squad'?['Rafi','Mira','Ayaan','Mehr'] : ['Nabila','Sana','Mira'];
      const extras=guestNames.filter(x=>x.toLowerCase()!==n.toLowerCase()).map((nickname,i)=>({id:uid(),nickname,status:'active',isHost:false,token:token(),joinedAt:now+i+1}));
      const room={code:c,title,createdAt:now,expiresAt:now+({'1h':3600000,'1d':86400000,'3d':259200000,'7d':604800000,'30d':2592000000,'90d':7776000000}[body.duration]||86400000),
        password:body.password||'',approvalRequired:!!body.approvalRequired,locked:false,guests:[host,...extras],messages:[],reactions:[],reports:[]};
      if(title==='University Project'){
        const stamp=Date.now()-24*60*1000;
        const sample=[
          {author:'Ayaan',body:'Hey everyone! Have you started working on the final report?'},
          {author:n,body:"Yes, I've finished the introduction part.\nI'll share it here in a few minutes."},
          {author:'Mehr',body:"Great! I'm working on the data analysis section. Can someone send the latest dataset?"},
          {author:'Rafi',body:"Here's the updated dataset.",attachment:{name:'project_dataset.xlsx',size:'2.4 MB'}},
          {author:n,body:"Thanks! Let's aim to complete the draft by tomorrow."}
        ];
        sample.forEach((msg,i)=>{
          const guest=room.guests.find(g=>g.nickname===msg.author)||host;
          room.messages.push({id:uid(),guestId:guest.id,author:msg.author,body:msg.body,
            attachment:msg.attachment,createdAt:stamp+i*3*60*1000});
        });
      }else{
        room.messages.push({id:uid(),guestId:extras[0]?.id||host.id,author:extras[0]?.nickname||n,body:'Hey! This is a sample conversation in the preview 👋',createdAt:now-300000});
        room.messages.push({id:uid(),guestId:extras[1]?.id||host.id,author:extras[1]?.nickname||n,body:'Looks great! Invite your group with one link ✨',createdAt:now-200000});
      }
      rooms[c]=room;save(rooms);
      return {code:c,token:host.token,room:safeRoom(room),guest:publicGuest(host)};
    }
    if(segments[0]!=='api'||segments[1]!=='rooms'||!segments[2])fail(404,'Not found.');
    const c=segments[2];const room=rooms[c];if(!room)fail(404,'Room not found. In the preview, create a demo room first.');
    const me=room.guests.find(g=>g.token===authToken);
    if(segments.length===3 && method==='GET')return {room:safeRoom(room),guest:publicGuest(me)};
    if(room.expiresAt<=Date.now())fail(410,'This room has expired.');
    if(segments[3]==='join' && method==='POST'){
      if(room.locked)fail(403,'This room is locked.');
      if(room.password && body.password!==room.password)fail(401,'Wrong password.');
      const name=String(body.nickname||'').trim();if(name.length<2)fail(400,'Nickname is too short.');
      if(room.guests.some(g=>g.nickname.toLowerCase()===name.toLowerCase()))fail(409,'That nickname is taken.');
      const guest={id:uid(),nickname:name,status:room.approvalRequired?'pending':'active',isHost:false,token:token(),joinedAt:Date.now()};
      room.guests.push(guest);save(rooms);return {guest:publicGuest(guest),token:guest.token};
    }
    if(!me)fail(401,'Join this room first.');
    if(me.status!=='active')fail(403,me.status==='pending'?'Waiting for host approval.':'Your room access is no longer valid.');
    if(segments[3]==='summary' && method==='GET'){
      const after=Number(u.searchParams.get('after')||0);
      const unread=me.status==='active'?room.messages.filter(m=>m.createdAt>after&&m.createdAt>=(me.isHost?0:me.joinedAt)&&m.guestId!==me.id).length:0;
      return {room:safeRoom(room),guest:publicGuest(me),unread:Math.min(999,unread)};
    }
    // Simulated message interactions: reactions are unique per guest and per message.
    function details(m){
      const referenced=room.messages.find(x=>x.id===m.replyToId);
      const visible=referenced&&(me.isHost||referenced.createdAt>=me.joinedAt);
      const votes=(room.reactions||[]).filter(r=>r.messageId===m.id);
      const reactions=[];
      for(const emoji of ['👍🏽','😂','😮','😢','😡','😭','🥀']){
        const count=votes.filter(v=>v.emoji===emoji).length;
        if(count)reactions.push({emoji,count});
      }
      return {...m,replyBody:visible?referenced.body:null,replyAuthor:visible?referenced.author:null,
        reactions,myReaction:votes.find(v=>v.guestId===me.id)?.emoji||null};
    }
    if(segments[3]==='reactions' && method==='POST'){
      if(!['👍🏽','😂','😮','😢','😡','😭','🥀'].includes(body.emoji))fail(400,'Choose a supported reaction.');
      const target=room.messages.find(m=>m.id===body.messageId&&(me.isHost||m.createdAt>=me.joinedAt));
      if(!target)fail(404,'Message not found in your room history.');
      room.reactions ||= [];
      const existing=room.reactions.findIndex(r=>r.messageId===body.messageId&&r.guestId===me.id);
      const was=existing>=0?room.reactions[existing].emoji:null;
      if(existing>=0)room.reactions.splice(existing,1);
      if(was!==body.emoji)room.reactions.push({messageId:body.messageId,guestId:me.id,emoji:body.emoji});
      save(rooms);
      const current=details(target);
      return {messageId:target.id,reactions:current.reactions,myReaction:current.myReaction};
    }
    if(segments[3]==='messages'){
      if(method==='GET'){
        let data=room.messages.filter(m=>me.isHost||m.createdAt>=me.joinedAt).slice();
        const cursor=u.searchParams.get('before')||u.searchParams.get('after');
        if(cursor){const [time,id]=cursor.split(':');if(u.searchParams.has('before'))data=data.filter(m=>m.createdAt<Number(time)||(m.createdAt===Number(time)&&m.id<id));
          else data=data.filter(m=>m.createdAt>Number(time)||(m.createdAt===Number(time)&&m.id>id));}
        data.sort((a,b)=>a.createdAt-b.createdAt||a.id.localeCompare(b.id));
        const refreshIds=(u.searchParams.get('react')||'').split(',').filter(Boolean).slice(0,40);
        const updates=Object.fromEntries(refreshIds.map(id=>{
          const message=room.messages.find(m=>m.id===id&&(me.isHost||m.createdAt>=me.joinedAt));
          const d=message?details(message):null;
          return [id,{reactions:d?.reactions||[],myReaction:d?.myReaction||null}];
        }));
        if(u.searchParams.has('after'))return {messages:data.slice(0,50).map(details),hasMore:false,reactionUpdates:updates,serverNow:Date.now()};
        return {messages:data.slice(-50).map(details),hasMore:data.length>50,reactionUpdates:updates,serverNow:Date.now()};
      }
      if(method==='POST'){
        if(!String(body.body||'').trim())fail(400,'Write a message.');
        if(body.replyToId && !room.messages.some(m=>m.id===body.replyToId&&(me.isHost||m.createdAt>=me.joinedAt)))fail(404,'The replied-to message is unavailable in your room history.');
        let saved=room.messages.find(m=>m.nonce===body.nonce&&m.guestId===me.id);
        if(!saved){saved={id:uid(),guestId:me.id,author:me.nickname,body:body.body,replyToId:body.replyToId||null,createdAt:Date.now(),nonce:body.nonce};room.messages.push(saved);save(rooms);}
        return {message:details(saved)};
      }
    }
    if(segments[3]==='members' && method==='GET')return {members:room.guests.filter(g=>g.status==='active'||(me.isHost&&g.status==='pending')).map(publicGuest),locked:room.locked,approvalRequired:room.approvalRequired};
    if(segments[3]==='moderate' && method==='POST'){
      if(!me.isHost)fail(403,'Only the host can do that.');
      const action=body.action;
      if(action==='lock')room.locked=true;
      else if(action==='unlock')room.locked=false;
      else if(action==='approval_on')room.approvalRequired=true;
      else if(action==='approval_off')room.approvalRequired=false;
      else if(action==='end')room.expiresAt=Date.now();
      else{const person=room.guests.find(g=>g.id===body.guestId);if(!person||person.isHost)fail(404,'Member not found.');
        person.status=action==='approve'?'active':action==='ban'?'banned':'kicked';}
      save(rooms);return {ok:true};
    }
    if(segments[3]==='reports'){
      if(method==='GET'){if(!me.isHost)fail(403,'Only hosts can view reports.');return {reports:room.reports};}
      if(method==='POST'){
        const target=room.guests.find(g=>g.id===body.targetId);if(!target)fail(404,'Member not found.');
        room.reports.push({id:uid(),reporter:me.nickname,target:target.nickname,reason:body.reason,createdAt:Date.now()});save(rooms);return {ok:true};
      }
    }
    if(segments[3]==='leave'&&method==='POST'){if(me.isHost)fail(403,'Host cannot leave without ending the room.');me.status='left';save(rooms);return {ok:true};}
    fail(404,'Not found.');
  };
})();
