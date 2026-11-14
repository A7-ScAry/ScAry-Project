/* ScAry Project: dependency-free browser client. Never renders user input as HTML. */
'use strict';
const $ = id => document.getElementById(id);
const DEMO = location.protocol === 'file:' || new URLSearchParams(location.search).has('demo');
const state = { code:null, room:null, guest:null, token:null, messages:[], members:[], hasMore:false,
  busy:false, flushing:false, timer:null, pendingTimer:null, lastMemberRefresh:0, lastInfoRefresh:0, navigationId:0, inboxChecking:false, lastInboxRefresh:0, inboxTimer:null };
let toastTimeout;
const activeFlushes = new Set();
const memoryStore = new Map(); // Fallback for browsers that disable storage in file previews.
function makeNonce(){
  if(typeof crypto.randomUUID==='function') return crypto.randomUUID();
  const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;
  const s=Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');
  return [s.slice(0,8),s.slice(8,12),s.slice(12,16),s.slice(16,20),s.slice(20)].join('-');
}
function storeGet(key) { try { return localStorage.getItem(key) ?? memoryStore.get(key) ?? null; } catch { return memoryStore.get(key) ?? null; } }
function storeSet(key,value) { memoryStore.set(key,value); try { localStorage.setItem(key,value); } catch {} }
function storeDelete(key) { memoryStore.delete(key); try { localStorage.removeItem(key); } catch {} }
function tokenKey(code) { return 'scary_project_token_' + code; }
function outboxKey(code) { return 'scary_project_outbox_' + code; }
function getOutboxFor(code) { try { const list=JSON.parse(storeGet(outboxKey(code)) || '[]');return Array.isArray(list)?list.slice(0,30):[]; } catch { return []; } }
function saveOutboxFor(code,items) { storeSet(outboxKey(code),JSON.stringify(items.slice(0,30))); }
function getOutbox(){return getOutboxFor(state.code);}
function saveOutbox(items){saveOutboxFor(state.code,items);}
function roomURL(code) { const u = new URL(location.href); u.pathname = location.protocol === 'file:' ? u.pathname : '/'; u.hash=''; u.search=''; if(DEMO && location.protocol !== 'file:')u.searchParams.set('demo','1'); u.searchParams.set('room',code); return u.toString(); }
function extractCode(input) {
  const val=String(input||'').trim();
  try { const u=new URL(val); const code=u.searchParams.get('room') || u.searchParams.get('r') || /\/room\/([A-Za-z2-9]{10})/.exec(u.pathname)?.[1]; return code && /^[A-HJ-NP-Z2-9]{10}$/i.test(code) ? code.toUpperCase() : null; } catch {}
  return /^[A-HJ-NP-Z2-9]{10}$/i.test(val) ? val.toUpperCase() : null;
}
function appIcon(name) {
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('class','ui-icon');svg.setAttribute('aria-hidden','true');
  const use=document.createElementNS('http://www.w3.org/2000/svg','use');
  use.setAttribute('href','#i-'+name);svg.append(use);return svg;
}
function roomDescriptor(title) {
  if(DEMO && title==='University Project')return 'Class assignment discussion';
  if(DEMO && title==='Gaming Squad')return 'Game plans and team chat';
  if(DEMO && title==='Friends Circle')return 'General discussion';
  return 'Temporary conversation';
}
function friendlyExpiry(ms) {
  if(ms<=0)return 'Expired';
  const days=Math.floor(ms/86400000),hours=Math.floor(ms%86400000/3600000),minutes=Math.floor(ms%3600000/60000);
  return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${Math.max(1,minutes)}m`;
}
const starredStorageKey='scary_project_starred_rooms_v1';
function starredCodes(){try{return JSON.parse(storeGet(starredStorageKey)||'[]').filter(x=>typeof x==='string');}catch{return [];}}
function isStarred(code){return starredCodes().includes(code);}
function toggleStarRoom(){
  if(!state.code)return;
  const starred=new Set(starredCodes());
  if(starred.has(state.code))starred.delete(state.code);else starred.add(state.code);
  storeSet(starredStorageKey,JSON.stringify([...starred].slice(0,100)));
  updateStarButton();renderMyRooms();notify(starred.has(state.code)?'Added to Starred Rooms.':'Removed from Starred Rooms.');
}
function updateStarButton(){
  const button=$('starRoomButton');if(!button)return;
  const active=!!state.code&&isStarred(state.code);
  button.classList.toggle('active',active);
  button.title=active?'Remove from Starred Rooms':'Star this room';
  button.setAttribute('aria-label',button.title);
}
function openSettings(){
  const side=$('roomSidebar');side.classList.add('open');
  if(!state.guest?.isHost){notify('Only the room host can change room settings.');return;}
  side.classList.add('settings-open');
  $('hostPanel').scrollIntoView({behavior:'smooth',block:'nearest'});
}
function applyInboxFilter(filter){
  roomInboxFilter=filter;
  document.querySelectorAll('[data-room-filter]').forEach(b=>{
    const active=b.dataset.roomFilter===filter;
    b.classList.toggle('selected',active);b.setAttribute('aria-pressed',String(active));
  });
  document.querySelectorAll('.room-rail-link').forEach(b=>b.classList.toggle('selected',
    b.dataset.scaryGo === (filter==='joined'?'joined':filter==='starred'?'starred':'myrooms')));
  renderMyRooms();
}
function notify(message) { const t=$('toast'); t.textContent=message; t.classList.add('visible'); clearTimeout(toastTimeout); toastTimeout=setTimeout(()=>t.classList.remove('visible'),4000); }
function errAt(id,message) { $(id).textContent=message||''; }
async function api(url, { method='GET', body=null, token=null }={}) {
  if(DEMO) return window.scaryDemoAPI(url,{method,body,token:token ?? state.token});
  const options={method,cache:'no-store',headers:{}};
  if(token ?? state.token) options.headers['X-Room-Token']=token ?? state.token;
  if(body!==null){options.headers['Content-Type']='application/json';options.body=JSON.stringify(body);}
  let response;
  try { response=await fetch(url,options); }
  catch {const e=new Error('Network unavailable. Check your connection.');e.offline=true;throw e;}
  const result=await response.json().catch(()=>({}));
  if(!response.ok){const e=new Error(result.error || `Request failed (${response.status}).`);e.status=response.status;throw e;}
  return result;
}
function setTab(tab) {
  const create=tab==='create';
  $('tabCreate').classList.toggle('active',create); $('tabJoin').classList.toggle('active',!create);
  $('tabCreate').setAttribute('aria-selected',String(create)); $('tabJoin').setAttribute('aria-selected',String(!create));
  $('createForm').classList.toggle('hidden',!create); $('joinForm').classList.toggle('hidden',create);
  $('recoverDetails').classList.toggle('hidden',create);
  $('waitingPanel').classList.add('hidden');
}
function stopPolling(){clearInterval(state.timer);clearInterval(state.pendingTimer);state.timer=null;state.pendingTimer=null;}
function resetHome(clearURL=true){
  stopPolling(); state.navigationId++; state.code=null;state.room=null;state.guest=null;state.token=null;state.messages=[];state.members=[];
  $('homeScreen').classList.remove('hidden');$('roomScreen').classList.add('hidden');$('siteFooter').classList.remove('hidden');
  $('roomSidebar').classList.remove('open','settings-open');$('createForm').classList.remove('hidden');$('joinForm').classList.remove('hidden');
  $('waitingPanel').classList.add('hidden');setTab('create');
  if(clearURL){const u=new URL(location.href);u.searchParams.delete('room');u.searchParams.delete('r');history.pushState({},'',u.toString());}
  renderMyRooms();refreshMyRooms();
}

async function visitRoom(code) {
  if(!code){notify('That is not a valid room code.');return;}
  stopPolling(); const nav=++state.navigationId;state.code=code;state.token=storeGet(tokenKey(code));state.guest=null;state.room=null;
  const u=new URL(location.href);u.searchParams.set('room',code);history.replaceState({},'',u.toString());
  $('joinCode').value=code;setTab('join');$('homeScreen').classList.remove('hidden');$('roomScreen').classList.add('hidden');
  try {
    const result=await api(`/api/rooms/${code}`,{token:state.token||''});
    if(nav!==state.navigationId)return;
    state.room=result.room;state.guest=result.guest;
    if(result.room.expired){rememberRoom(code,result.room,result.guest,{status:'expired'});errAt('joinError','This room has expired. Create a new one.');return;}
    $('joinRoomHint').textContent=`You're joining: ${result.room.title}`;$('joinRoomHint').classList.remove('hidden');
    $('joinPasswordRow').classList.toggle('hidden',!result.room.passwordRequired);
    if(result.guest?.status==='active'){rememberRoom(code,result.room,result.guest);await enterRoom();return;}
    if(result.guest?.status==='pending'){rememberRoom(code,result.room,result.guest);showWaiting();return;}
    if(result.guest?.status==='banned'||result.guest?.status==='kicked'||result.guest?.status==='left') {
      state.token=null;storeDelete(tokenKey(code));forgetRoom(code,true);
      errAt('joinError',result.guest.status==='left' ? 'You left this room. Use a new nickname if you wish to rejoin.' : 'Your previous room access was removed.');
    }
  } catch(error){if(nav===state.navigationId)errAt('joinError',error.message);}
}

function showWaiting(){
  $('createForm').classList.add('hidden');$('joinForm').classList.add('hidden');$('waitingPanel').classList.remove('hidden');
  clearInterval(state.pendingTimer);
  const code=state.code, nav=state.navigationId, token=state.token;
  state.pendingTimer=setInterval(async()=>{
    if(document.hidden || state.code!==code || state.navigationId!==nav) return;
    try{const result=await api(`/api/rooms/${code}`,{token});if(state.navigationId!==nav)return;state.room=result.room;state.guest=result.guest;
      if(result.room.expired){stopPolling();errAt('joinError','This room expired before approval.');setTab('join');}
      else if(result.guest?.status==='active') await enterRoom();
      else if(result.guest?.status !== 'pending'){stopPolling();setTab('join');errAt('joinError','Your request was declined.');}
    }catch{}},5000);
}
async function createRoom(event){
  event.preventDefault(); errAt('createError','');
  const button=$('createButton');button.disabled=true;
  try{
    const body={title:$('createTitle').value,nickname:$('createNickname').value,
      duration:document.querySelector('input[name="duration"]:checked').value,password:$('createPassword').value,
      approvalRequired:$('approvalRequired').checked};
    const data=await api('/api/rooms',{method:'POST',body});
    state.code=data.code;state.token=data.token;storeSet(tokenKey(data.code),data.token);
    state.room=data.room;state.guest=data.guest;
    rememberRoom(data.code,data.room,data.guest);
    const u=new URL(location.href);u.searchParams.set('room',data.code);history.pushState({},'',u.toString());
    await visitRoom(data.code);notify('Room created. Share your invitation link!');
  }catch(error){errAt('createError',error.message);}finally{button.disabled=false;}
}
async function joinRoom(event){
  event.preventDefault();errAt('joinError','');
  const code=extractCode($('joinCode').value);
  if(!code){errAt('joinError','Enter a valid room link or 10-character code.');return;}
  const button=$('joinButton');button.disabled=true;
  try {
    const info=await api(`/api/rooms/${code}`,{token:''});
    state.room=info.room;
    if(info.room.expired) throw new Error('This room has already expired.');
    if(info.room.passwordRequired && !$('joinPassword').value){$('joinPasswordRow').classList.remove('hidden');throw new Error('Enter the room password first.');}
    const data=await api(`/api/rooms/${code}/join`,{method:'POST',token:'',body:{nickname:$('joinNickname').value,password:$('joinPassword').value}});
    state.code=code;state.token=data.token;state.guest=data.guest;
    storeSet(tokenKey(code),data.token);rememberRoom(code,info.room,data.guest);
    const u=new URL(location.href);u.searchParams.set('room',code);history.pushState({},'',u.toString());
    $('joinPassword').value='';
    if(data.guest.status==='pending'){showWaiting();notify('Request sent. Waiting for host approval.');}
    else {await enterRoom();notify('Welcome to the room!');}
  }catch(error){errAt('joinError',error.message);}finally{button.disabled=false;}
}
async function enterRoom(){
  if(!state.code||!state.guest||state.guest.status!=='active')return;
  stopPolling();
  rememberRoom(state.code,state.room,state.guest,{opened:true});
  $('homeScreen').classList.add('hidden');$('roomScreen').classList.remove('hidden');$('siteFooter').classList.add('hidden');
  $('roomTitle').textContent=state.room.title;$('roomTitleTop').textContent=state.room.title;
  
  $('roomDescription').textContent=roomDescriptor(state.room.title);
  $('roomSidebar').classList.toggle('i-am-host',!!state.guest.isHost);
  $('roomAccessLabel').textContent=state.room.passwordRequired?'Private (Password)':'Invite link';
  updateStarButton();

  $('roomSidebar').classList.remove('open','settings-open');renderMyRooms();
  $('roomCodeLabel').textContent=state.code;
  $('hostPanel').classList.toggle('hidden',!state.guest.isHost);
  $('leaveButton').replaceChildren(appIcon('arrow'),document.createTextNode(state.guest.isHost?' End room':' Leave room'));
  $('lockToggle').checked=!!state.room.locked;$('approvalToggle').checked=!!state.room.approvalRequired;
  state.messages=[];state.hasMore=false;state.lastMemberRefresh=0;state.lastInfoRefresh=0;
  updateExpiry();updateQueue();
  try{await Promise.all([loadMessages(true),loadMembers()]);}catch(error){notify(error.message);}
  const code=state.code, nav=state.navigationId;
  state.timer=setInterval(async()=>{
    updateExpiry(); if(document.hidden||!state.code||state.code!==code||state.navigationId!==nav)return;
    try{
      await loadMessages();
      const now=Date.now();
      if(now-state.lastMemberRefresh>16000)await loadMembers();
      if(now-state.lastInfoRefresh>20000){await refreshInfo();state.lastInfoRefresh=now;}
      if(code!==state.code||nav!==state.navigationId)return;
      if(now-state.lastInboxRefresh>55000)refreshMyRooms();
      $('connectionIndicator').textContent='Connected';$('connectionIndicator').classList.remove('offline');
      if(navigator.onLine!==false) await flushOutbox();
    }catch(error){
      if(error.status===410){notify('Room expired.');resetHome();return;}
      if(error.status===401||error.status===403){notify(error.message);resetHome();return;}
      $('connectionIndicator').textContent='Offline';$('connectionIndicator').classList.add('offline');
    }
  },4500);
  $('messageInput').focus();
}
async function refreshInfo(){
  const code=state.code,nav=state.navigationId,token=state.token;
  const data=await api(`/api/rooms/${code}`,{token});
  if(nav!==state.navigationId)return;
  if(data.room.expired){notify('This room has expired.');resetHome();return;}
  state.room=data.room;state.guest=data.guest;
  rememberRoom(code,data.room,data.guest);
  if(!data.guest||data.guest.status!=='active'){notify('Your room access has ended.');resetHome();return;}
  $('lockToggle').checked=!!data.room.locked;$('approvalToggle').checked=!!data.room.approvalRequired;
  $('roomAccessLabel').textContent=data.room.passwordRequired?'Private (Password)':'Invite link';
  updateExpiry();
}
function updateExpiry(){if(!state.room)return;let seconds=Math.max(0,Math.ceil((state.room.expiresAt-Date.now())/1000));
  const days=Math.floor(seconds/86400);seconds%=86400;const h=Math.floor(seconds/3600),m=Math.floor((seconds%3600)/60),s=seconds%60;
  const countdown=(days?`${days}d `:'')+[h,m,s].map(x=>String(x).padStart(2,'0')).join(':');
  $('expirySidebar').textContent=friendlyExpiry(state.room.expiresAt-Date.now());
  $('expirySidebar').title=countdown;
  $('expiryTop').textContent='Expires in '+friendlyExpiry(state.room.expiresAt-Date.now());
  $('messageInput').disabled=state.room.expiresAt<=Date.now();
  $('sendButton').disabled=state.room.expiresAt<=Date.now();
}

function cursor(msg){return `${msg.createdAt}:${msg.id}`;}
function mergeMessages(incoming){
  const all=new Map(state.messages.map(msg=>[msg.id,msg]));for(const msg of incoming||[])all.set(msg.id,msg);
  state.messages=[...all.values()].sort((a,b)=>a.createdAt-b.createdAt||a.id.localeCompare(b.id));
}
async function loadMessages(initial=false){
  if(!state.code||!state.guest)return;
  const code=state.code,token=state.token,nav=state.navigationId;
  const last=!initial?state.messages.at(-1):null;
  const url=`/api/rooms/${code}/messages`+(last?'?after='+encodeURIComponent(cursor(last)):'');
  const data=await api(url,{token});
  if(code!==state.code||nav!==state.navigationId)return;
  if(initial)state.messages=data.messages||[];
  else mergeMessages(data.messages||[]);
  if(initial){state.hasMore=!!data.hasMore;$('olderButton').classList.toggle('hidden',!state.hasMore);}
  if(initial||data.messages?.length){renderMessages();if(initial){if(DEMO&&state.room?.title==='University Project')$('messagesWrap').scrollTop=0;else scrollDown(true);}}
  if(!document.hidden && !$('roomScreen').classList.contains('hidden')) markRead(code,Math.max(data.serverNow||0,0));
}

async function olderMessages(){
  if(!state.hasMore||!state.messages.length)return;
  const wrap=$('messagesWrap'),height=wrap.scrollHeight;
  $('olderButton').disabled=true;
  const code=state.code,nav=state.navigationId,token=state.token;
  try{const data=await api(`/api/rooms/${code}/messages?before=${encodeURIComponent(cursor(state.messages[0]))}`,{token});
    if(code!==state.code||nav!==state.navigationId)return;
    mergeMessages(data.messages);state.hasMore=!!data.hasMore;$('olderButton').classList.toggle('hidden',!state.hasMore);
    renderMessages();wrap.scrollTop=wrap.scrollHeight-height+wrap.scrollTop;
  }catch(error){notify(error.message);}finally{$('olderButton').disabled=false;}
}
function renderMessages(){
  const wrap=$('messagesWrap'),wasNearBottom=wrap.scrollHeight-wrap.scrollTop-wrap.clientHeight<120;
  const container=$('messagesList');container.replaceChildren();
  const first=state.messages[0];
  if(first){const dt=new Date(first.createdAt),today=new Date();
    $('timelineDate').textContent=dt.toDateString()===today.toDateString()?'Today':dt.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
  }else $('timelineDate').textContent='Today';
  if(!state.messages.length&&!getOutbox().length){const p=document.createElement('div');p.className='empty-messages';
    const title=document.createElement('strong');title.textContent='A room full of possibilities.';p.append(title,document.createTextNode('Start the conversation with a simple hello.'));container.append(p);}
  for(const message of state.messages){
    appendMessage(container,message,message.guestId===state.guest?.id,false);
  }
  for(const queued of getOutbox()){
    appendMessage(container,{author:state.guest?.nickname||'You',body:queued.body,createdAt:queued.createdAt},true,true);
  }
  if(wasNearBottom && !(DEMO && window.innerWidth>780 && state.room?.title==='University Project' && state.messages.length===5))scrollDown();
}
function appendMessage(container,mineData,mine,queued){
  const row=document.createElement('div');row.className='message-row'+(mine?' mine':'')+(queued?' queued':'');
  if(!mine){
    const avatar=document.createElement('span');avatar.className='message-avatar';
    const n=String(mineData.author||'?');avatar.textContent=n.charAt(0).toUpperCase();
    avatar.classList.add('tone-'+(n.charCodeAt(0)%4));row.append(avatar);
  }
  const stack=document.createElement('div');stack.className='message-stack';
  const byline=document.createElement('div');byline.className='message-byline';
  const author=document.createElement('span');author.textContent=mine?'You':mineData.author;
  const time=document.createElement('span');time.className='msg-time';
  time.textContent=queued?'Saved locally':new Date(mineData.createdAt).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
  byline.append(author,time);stack.append(byline);
  const bubble=document.createElement('div');bubble.className='message-body';
  // Demo-only artwork: file previews are not an upload or download service.
  if(DEMO && mineData.attachment){
    const file=document.createElement('button');file.className='file-preview-card';file.type='button';
    file.append(appIcon('file'));
    const meta=document.createElement('span');meta.className='file-meta';
    const title=document.createElement('strong');title.textContent=mineData.attachment.name;
    const size=document.createElement('small');size.textContent=mineData.attachment.size;
    meta.append(title,size);file.append(meta);
    const down=appIcon('download');down.classList.add('download-icon');file.append(down);
    file.addEventListener('click',()=>notify('Sample file only. This text-only release does not upload or download attachments.'));
    bubble.append(file);
    if(mineData.body)bubble.append(document.createTextNode(mineData.body));
  }else bubble.textContent=mineData.body;
  stack.append(bubble);
  if(mine){const footer=document.createElement('span');footer.className='message-footer-time';
    footer.textContent=queued?'Saved locally':new Date(mineData.createdAt).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
    if(!queued){const tick=document.createElement('span');tick.className='tick';tick.textContent=' ✓✓';footer.append(tick);}
    stack.append(footer);
  }
  row.append(stack);container.append(row);
}
function scrollDown(force=false){const w=$('messagesWrap');if(force)w.scrollTop=w.scrollHeight;else requestAnimationFrame(()=>w.scrollTop=w.scrollHeight);}
function updateQueue(){const n=getOutbox().length;$('queuedCount').textContent=n?`${n} queued on this device`:'';$('queuedCount').classList.toggle('hidden',!n);
  $('deliveryStatus').textContent=n?'Queued messages send when your connection returns.':'Messages stay inside this room.';}
async function sendMessage(event){
  event.preventDefault();if(!state.code||state.guest?.status!=='active')return;
  const input=$('messageInput');const text=input.value.trim();if(!text)return;
  if([...text].length>1200){notify('Maximum 1,200 characters per message.');return;}
  const items=getOutbox();if(items.length>=30){notify('Your offline queue is full. Reconnect to send saved messages.');return;}
  items.push({nonce:makeNonce(),body:text,createdAt:Date.now()});saveOutbox(items);
  input.value='';input.style.height='auto';updateQueue();renderMessages();scrollDown(true);
  await flushOutbox();
}
async function flushOutbox(){
  const code=state.code,token=state.token;
  if(!code||!token||state.guest?.status!=='active'||activeFlushes.has(code))return;
  activeFlushes.add(code);
  try{
    while(getOutboxFor(code).length){
      const first=getOutboxFor(code)[0];
      try{
        await api(`/api/rooms/${code}/messages`,{method:'POST',token,body:{body:first.body,nonce:first.nonce}});
        const items=getOutboxFor(code);
        if(items[0]?.nonce===first.nonce){items.shift();saveOutboxFor(code,items);}
        if(code===state.code)updateQueue();
      }catch(error){
        if(code===state.code){
          if(error.offline){$('connectionIndicator').textContent='Offline';$('connectionIndicator').classList.add('offline');notify('Message saved on this device until connection returns.');}
          else notify('Message not sent: '+error.message);
        }
        break;
      }
    }
    if(code===state.code){await loadMessages();renderMessages();}
  }catch{}finally{activeFlushes.delete(code);}
}
async function loadMembers(){
  if(!state.code)return;
  const code=state.code,token=state.token,nav=state.navigationId;
  const data=await api(`/api/rooms/${code}/members`,{token});
  if(nav!==state.navigationId)return;
  state.members=data.members||[];state.lastMemberRefresh=Date.now();
  const activeCount=state.members.filter(x=>x.status==='active').length;
  $('memberCount').textContent=String(activeCount);
  $('memberCountTop').textContent=activeCount+' '+(activeCount===1?'member':'members');
  $('lockToggle').checked=!!data.locked;$('approvalToggle').checked=!!data.approvalRequired;
  renderMembers();
}
function renderMembers(){
  const list=$('membersList');list.replaceChildren();
  for(const member of state.members){
    const row=document.createElement('div');row.className='member-row';
    const avatar=document.createElement('div');avatar.className='member-avatar';avatar.textContent=member.nickname[0].toUpperCase();
    const info=document.createElement('div');info.className='member-details';
    const name=document.createElement('div');name.className='member-name';
    name.textContent=member.nickname+(member.id===state.guest.id?' (You)':'');
    const role=document.createElement('span');role.className='member-role-badge';
    role.textContent=member.isHost?'Host':member.status==='pending'?'Pending':'Member';
    if(member.isHost)role.classList.add('host');if(member.status==='pending')role.classList.add('pending');
    info.append(name,role);row.append(avatar,info);
    if(member.id!==state.guest.id){
      const actions=document.createElement('div');actions.className='member-actions';
      const add=(label,handler)=>{const b=document.createElement('button');b.textContent=label;b.type='button';b.addEventListener('click',handler);actions.append(b);};
      if(state.guest.isHost){
        if(member.status==='pending'){add('Approve',()=>moderate('approve',member));add('Reject',()=>moderate('reject',member));}
        else if(!member.isHost){add('Remove',()=>moderate('kick',member));add('Ban',()=>moderate('ban',member));}
      }else if(member.status==='active')add('Report',()=>report(member));
      row.append(actions);
    }
    list.append(row);
  }
  $('showAllMembersButton').classList.toggle('hidden',state.members.length<=4);
}
async function moderate(action,member){
  const label={approve:'approve',reject:'decline',kick:'remove',ban:'ban'}[action];
  if(!confirm(`Are you sure you want to ${label} ${member.nickname}?`))return;
  try{await api(`/api/rooms/${state.code}/moderate`,{method:'POST',body:{action,guestId:member.id}});await loadMembers();notify('Member updated.');}
  catch(error){notify(error.message);}
}
async function report(member){
  const reason=prompt(`Why are you reporting ${member.nickname}? The room host will see your report.`);
  if(reason===null)return;
  if(reason.trim().length<5){notify('Please explain the reason (at least 5 characters).');return;}
  try{await api(`/api/rooms/${state.code}/reports`,{method:'POST',body:{targetId:member.id,reason}});notify('Report sent to the host.');}
  catch(error){notify(error.message);}
}
async function hostOption(action,element){
  try{await api(`/api/rooms/${state.code}/moderate`,{method:'POST',body:{action}});await refreshInfo();notify('Room settings updated.');}
  catch(error){element.checked=!element.checked;notify(error.message);}
}
async function viewReports(){
  const panel=$('reportsPanel');if(!panel.classList.contains('hidden')){panel.classList.add('hidden');return;}
  try{const data=await api(`/api/rooms/${state.code}/reports`);panel.replaceChildren();
    if(!data.reports.length){const p=document.createElement('div');p.className='report-entry';p.textContent='No reports yet.';panel.append(p);}
    for(const entry of data.reports){const div=document.createElement('div');div.className='report-entry';
      const s=document.createElement('strong');s.textContent=`${entry.reporter} → ${entry.target}`;
      div.append(s,document.createTextNode(' · '+entry.reason));panel.append(div);}
    panel.classList.remove('hidden');
  }catch(error){notify(error.message);}
}
async function endRoom(){
  if(!confirm('End this room now? All participants will lose access immediately.'))return;
  try{const code=state.code;await api(`/api/rooms/${code}/moderate`,{method:'POST',body:{action:'end'}});rememberRoom(code,{...state.room,expired:true,expiresAt:Date.now()},state.guest,{status:'expired'});notify('Room ended.');resetHome();}
  catch(error){notify(error.message);}
}
async function leaveRoom(){
  if(state.guest?.isHost){await endRoom();return;}
  if(!confirm('Leave this room? You will no longer be able to read its messages.'))return;
  try{await api(`/api/rooms/${state.code}/leave`,{method:'POST'});const code=state.code;forgetRoom(code,true);notify('You left the room.');resetHome();}
  catch(error){notify(error.message);}
}
async function copyInvite(){
  const link=roomURL(state.code);if(DEMO){notify('This is a local design preview. Links cannot invite real people yet.');return;}
  try{await navigator.clipboard.writeText(link);notify('Invitation link copied!');}
  catch{prompt('Copy your room link:',link);}
}
// My Rooms: a device-local index; only the server can validate membership.
// Access tokens are never put into invitation URLs or into the room list metadata.
const ROOM_INDEX_KEY = 'scary_project_my_rooms_v1';
const ROOM_INDEX_LIMIT = 50;
function indexedRooms(){
  try{
    const data=JSON.parse(storeGet(ROOM_INDEX_KEY)||'[]');
    if(!Array.isArray(data))return [];
    return data.filter(x=>x&&typeof x.code==='string'&&/^[A-HJ-NP-Z2-9]{10}$/.test(x.code))
      .slice(0,ROOM_INDEX_LIMIT);
  }catch{return [];}
}
function saveIndexedRooms(rooms){storeSet(ROOM_INDEX_KEY,JSON.stringify(rooms.slice(0,ROOM_INDEX_LIMIT)));}
function rememberRoom(code,room,guest,{opened=false,status=null}={}){
  if(!code || !room)return;
  const list=indexedRooms(),previous=list.find(x=>x.code===code)||{};
  const entry={...previous,code,title:room.title||previous.title||'Untitled room',
    expiresAt:room.expiresAt??previous.expiresAt??0,
    status:status||(room.expired?'expired':guest?.status||previous.status||'active'),
    nickname:guest?.nickname||previous.nickname||'',isHost:guest?.isHost??previous.isHost??false,
    memberCount:room.memberCount??previous.memberCount??1,
    openedAt:opened?Date.now():(previous.openedAt||Date.now()),
    seenAt:previous.seenAt||0,unread:previous.unread||0};
  const all=[entry,...list.filter(x=>x.code!==code)].sort((a,b)=>b.openedAt-a.openedAt);
  saveIndexedRooms(all);renderMyRooms();
}
function updateIndexedRoom(code,patch){
  const list=indexedRooms(),at=list.findIndex(x=>x.code===code);if(at<0)return;
  list[at]={...list[at],...patch};saveIndexedRooms(list);renderMyRooms();
}
function forgetRoom(code,clearToken=false){
  saveIndexedRooms(indexedRooms().filter(x=>x.code!==code));
  if(clearToken){storeDelete(tokenKey(code));storeDelete(outboxKey(code));}
  renderMyRooms();
}
function markRead(code,serverTime){
  const entry=indexedRooms().find(x=>x.code===code);
  if(!entry || !Number.isFinite(serverTime)||serverTime<=0)return;
  updateIndexedRoom(code,{seenAt:Math.max(entry.seenAt||0,serverTime),unread:0});
}
function relativeExpiry(expiresAt){
  const ms=Number(expiresAt)-Date.now();
  if(!Number.isFinite(ms)||ms<=0)return 'Expired';
  const mins=Math.ceil(ms/60000);
  if(mins<60)return `${mins} min left`;
  const hrs=Math.ceil(ms/3600000);
  if(hrs<=24)return `${hrs} hr left`;
  return `${Math.ceil(ms/86400000)} days left`;
}
function roomStatus(entry){
  if(entry.status==='expired'||entry.expiresAt<=Date.now())return 'Expired';
  if(entry.status==='pending')return 'Waiting for approval';
  if(entry.status==='active')return entry.isHost?'Host':'Member';
  return 'Access ended';
}
function buildRoomButton(entry,compact=false){
  const item=document.createElement('div');item.className='myroom-item'+(compact?' compact':'');
  if(entry.code===state.code)item.classList.add('current');
  const b=document.createElement('button');b.type='button';b.className='myroom-open';
  const monogram=document.createElement('span');monogram.className='myroom-icon';
  if(compact)monogram.append(appIcon(/gam/i.test(entry.title)?'game':'users'));
  else monogram.textContent=(entry.title||'R')[0].toUpperCase();
  const content=document.createElement('span');content.className='myroom-content';
  const title=document.createElement('strong');title.textContent=entry.title;
  const meta=document.createElement('small');
  meta.textContent=compact?roomDescriptor(entry.title):`${roomStatus(entry)} · ${relativeExpiry(entry.expiresAt)}`;
  content.append(title,meta);
  if(compact){
    const brief=document.createElement('div');brief.className='room-brief-meta';
    const members=document.createElement('span');members.append(appIcon('users'),document.createTextNode(String(entry.memberCount||1)));
    const expires=document.createElement('span');expires.append(appIcon('clock'),document.createTextNode(relativeExpiry(entry.expiresAt)));
    brief.append(members,expires);content.append(brief);
  }
  b.append(monogram,content);
  const unread=Number(entry.unread)||0;
  if(unread>0 && entry.status==='active' && entry.expiresAt>Date.now()){
    const badge=document.createElement('span');badge.className='myroom-unread';badge.textContent=unread>99?'99+':String(unread);
    badge.setAttribute('aria-label',`${unread} unread messages`);b.append(badge);
  }
  b.addEventListener('click',()=>{
    if(entry.status==='expired'||entry.expiresAt<=Date.now()){
      notify('This room has expired. Create another to keep talking.');return;
    }
    if(entry.status!=='active'&&entry.status!=='pending'){
      notify('This device no longer has access to that room.');return;
    }
    visitRoom(entry.code);
  });
  item.append(b);
  if(!compact && (entry.status==='expired'||entry.expiresAt<=Date.now()||!['active','pending'].includes(entry.status))){
    const remove=document.createElement('button');remove.type='button';remove.className='myroom-forget';remove.textContent='Dismiss';
    remove.setAttribute('aria-label',`Remove ${entry.title} from My Rooms`);
    remove.addEventListener('click',()=>forgetRoom(entry.code,true));item.append(remove);
  }
  return item;
}
let roomInboxFilter='all';
function renderMyRooms(){
  const list=indexedRooms().sort((a,b)=>b.openedAt-a.openedAt);
  const active=list.filter(x=>x.expiresAt>Date.now() && ['active','pending'].includes(x.status));
  const unread=active.reduce((n,x)=>n+(Number(x.unread)||0),0);
  $('myRoomsCount').textContent=`${active.length} active`;
  $('myRoomsNavBadge').textContent=String(active.length);
  $('myRoomsList').replaceChildren();$('sidebarRoomList').replaceChildren();$('roomInboxList').replaceChildren();
  $('myRoomsEmpty').classList.toggle('hidden',list.length>0);
  for(const entry of list) $('myRoomsList').append(buildRoomButton(entry));
  for(const entry of active.slice(0,12)) $('sidebarRoomList').append(buildRoomButton(entry,true));
  const search=$('roomInboxSearch').value.trim().toLocaleLowerCase();
  const matching=list.filter(entry=>
    (!search || (entry.title||'').toLocaleLowerCase().includes(search) || entry.code.toLocaleLowerCase().includes(search)) &&
    (roomInboxFilter==='all' || (roomInboxFilter==='host' ? entry.isHost : roomInboxFilter==='starred' ? isStarred(entry.code) : !entry.isHost)));
  if(!matching.length){
    const empty=document.createElement('p');empty.className='room-inbox-empty';
    empty.textContent=search?'No rooms match your search.':'No rooms here yet. Create or join a room to get started.';
    $('roomInboxList').append(empty);
  }
  for(const entry of matching) $('roomInboxList').append(buildRoomButton(entry,true));
  $('sidebarRoomSection').classList.toggle('hidden',active.length===0);
  $('roomHomeButton').textContent=unread?`My Rooms · ${unread>99?'99+':unread}`:'My Rooms';
}
async function refreshMyRooms(force=false){
  if(state.inboxChecking || (document.hidden&&!force))return;
  if(!force&&Date.now()-state.lastInboxRefresh<25000)return;
  const entries=indexedRooms();state.inboxChecking=true;state.lastInboxRefresh=Date.now();
  $('refreshMyRoomsButton').disabled=true;
  try{
    // Four parallel requests at most, to keep this lightweight on free hosting.
    const queue=entries.slice();
    await Promise.all(Array.from({length:Math.min(4,queue.length)},async()=>{
      while(queue.length){
        const item=queue.shift(),token=storeGet(tokenKey(item.code));
        if(!token){updateIndexedRoom(item.code,{status:'invalid',unread:0});continue;}
        try{
          const data=await api(`/api/rooms/${item.code}/summary?after=${encodeURIComponent(item.seenAt||0)}`,{token});
          const currentlyOpen=item.code===state.code&&state.guest?.status==='active'&&!document.hidden&&
            !$('roomScreen').classList.contains('hidden');
          const existing=indexedRooms().find(x=>x.code===item.code);
          if(!existing)continue;
          const unread=currentlyOpen?0:(data.unread||0);
          updateIndexedRoom(item.code,{title:data.room.title,expiresAt:data.room.expiresAt,
            nickname:data.guest.nickname,isHost:data.guest.isHost,
            status:data.room.expired?'expired':data.guest.status,unread});
        }catch(error){
          if(error.status===404||error.status===410)updateIndexedRoom(item.code,{status:'expired',unread:0});
          else if(error.status===401||error.status===403)updateIndexedRoom(item.code,{status:'invalid',unread:0});
          // Transient connection errors: keep cached entries and unread indicators.
        }
      }
    }));
  }finally{state.inboxChecking=false;$('refreshMyRoomsButton').disabled=false;renderMyRooms();}
}
async function copyAccessKey(){
  if(!state.token)return notify('Open a room first.');
  if(!confirm('Your access key controls your room identity. Anyone who has it can act as you (including as host). Keep it secret. Copy it now?'))return;
  try{
    await navigator.clipboard.writeText(state.token);
    notify('Secret access key copied. Store it privately — never share it with guests.');
  }catch{prompt('Copy your secret access key and keep it private:',state.token);}
}
async function recoverRoom(event){
  event.preventDefault();errAt('recoverError','');
  const code=extractCode($('recoverCode').value),secret=$('recoverToken').value.trim().toLowerCase();
  if(!code){errAt('recoverError','Enter a valid room link or code.');return;}
  if(!/^[0-9a-f]{64}$/.test(secret)){errAt('recoverError','The access key must be exactly 64 hexadecimal characters.');return;}
  const button=$('recoverButton');button.disabled=true;
  try{
    const data=await api(`/api/rooms/${code}`,{token:secret});
    if(!data.guest||!['active','pending'].includes(data.guest.status))throw new Error('This access key does not have active room access.');
    if(data.room.expired)throw new Error('This room has expired.');
    storeSet(tokenKey(code),secret);rememberRoom(code,data.room,data.guest);
    $('recoverToken').value='';$('recoverDetails').open=false;
    await visitRoom(code);notify('Your room access has been restored.');
  }catch(error){errAt('recoverError',error.message);}
  finally{button.disabled=false;}
}

function setupEvents(){
  $('tabCreate').addEventListener('click',()=>setTab('create'));
  $('tabJoin').addEventListener('click',()=>setTab('join'));
  $('createForm').addEventListener('submit',createRoom);$('joinForm').addEventListener('submit',joinRoom);
  $('joinCode').addEventListener('blur',async()=>{const code=extractCode($('joinCode').value);if(!code)return;
    try{const d=await api(`/api/rooms/${code}`,{token:''});$('joinRoomHint').textContent=`You're joining: ${d.room.title}`;$('joinRoomHint').classList.remove('hidden');$('joinPasswordRow').classList.toggle('hidden',!d.room.passwordRequired);}catch{}}
  );
  $('waitingBack').addEventListener('click',()=>resetHome());
  $('roomHomeButton').addEventListener('click',()=>resetHome());
  $('sidebarHomeButton').addEventListener('click',()=>resetHome());
  $('refreshMyRoomsButton').addEventListener('click',()=>refreshMyRooms(true));
  // Navigation is shared across the home page and the dashboard; it never leaves a room.
  document.querySelectorAll('[data-scary-go]').forEach(button=>button.addEventListener('click',()=>{
    const destination=button.dataset.scaryGo;
    if(destination==='about'){$('aboutDialog').showModal();return;}
    const inRoom=!$('roomScreen').classList.contains('hidden');
    if(inRoom && ['myrooms','joined','starred'].includes(destination)){
      applyInboxFilter(destination==='joined'?'joined':destination==='starred'?'starred':'all');
      if(window.matchMedia('(max-width:780px)').matches){
        resetHome();$('myRoomsSection').scrollIntoView({behavior:'smooth'});
      }
      return;
    }
    if(inRoom)resetHome();
    if(destination==='join' || destination==='recover')setTab('join');
    else if(destination==='create')setTab('create');
    if(destination==='recover')$('recoverDetails').open=true;
    const target=destination==='myrooms'?'myRoomsSection':destination==='home'?'homeScreen':'createForm';
    if(destination==='join'||destination==='recover')$('tabJoin').scrollIntoView({behavior:'smooth',block:'center'});
    else if(destination==='create')$('tabCreate').scrollIntoView({behavior:'smooth',block:'center'});
    else $(target).scrollIntoView({behavior:'smooth',block:'start'});
  }));
  $('roomInboxSearch').addEventListener('input',renderMyRooms);
  document.querySelectorAll('[data-room-filter]').forEach(button=>button.addEventListener('click',()=>{
    roomInboxFilter=button.dataset.roomFilter;
    document.querySelectorAll('[data-room-filter]').forEach(b=>{
      const active=b===button;b.classList.toggle('selected',active);b.setAttribute('aria-pressed',String(active));
    });
    renderMyRooms();
  }));

  $('copyAccessKeyButton').addEventListener('click',copyAccessKey);
  $('recoverForm').addEventListener('submit',recoverRoom);
  $('openJoinRecovery').addEventListener('click',()=>{setTab('join');$('recoverDetails').open=true;});
  $('brandLink').addEventListener('click',event=>{if(state.code){event.preventDefault();resetHome();}});
  $('messageForm').addEventListener('submit',sendMessage);
  $('messageInput').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();$('messageForm').requestSubmit();}});
  $('olderButton').addEventListener('click',olderMessages);
  $('shareButton').addEventListener('click',copyInvite);$('copySmall').addEventListener('click',copyInvite);
  $('leaveButton').addEventListener('click',leaveRoom);$('endRoomButton').addEventListener('click',endRoom);
  $('sidebarToggle').addEventListener('click',()=>$('roomSidebar').classList.toggle('open'));
  $('sidebarClose').addEventListener('click',()=>$('roomSidebar').classList.remove('open'));
  $('lockToggle').addEventListener('change',event=>hostOption(event.target.checked?'lock':'unlock',event.target));
  $('approvalToggle').addEventListener('change',event=>hostOption(event.target.checked?'approval_on':'approval_off',event.target));
  $('reportsButton').addEventListener('click',viewReports);
  $('starRoomButton').addEventListener('click',toggleStarRoom);
  $('quickInviteButton').addEventListener('click',copyInvite);
  $('openRoomSettings').addEventListener('click',openSettings);
  $('infoSettingsButton').addEventListener('click',openSettings);
  $('manageMembersButton').addEventListener('click',()=>{
    const section=document.querySelector('.members-section');
    section.classList.toggle('managing');
    $('membersList').classList.add('expanded');
    $('manageMembersButton').textContent=section.classList.contains('managing')?'Done':'Manage';
  });
  $('showAllMembersButton').addEventListener('click',()=>{
    const expanded=$('membersList').classList.toggle('expanded');
    $('showAllMembersButton').replaceChildren(document.createTextNode(expanded?'Show Less':'Show All Members'),appIcon('chevron'));
  });
  $('attachmentButton').addEventListener('click',()=>notify('ScAry Project is text-only. File uploads are not available in this release.'));
  $('emojiButton').addEventListener('click',()=>{
    const input=$('messageInput');const start=input.selectionStart,end=input.selectionEnd;
    input.value=input.value.slice(0,start)+'😊'+input.value.slice(end);
    input.focus();input.setSelectionRange(start+2,start+2);
  });
  $('moreRecoveryButton').addEventListener('click',copyAccessKey);
  $('aboutCloseButton').addEventListener('click',()=>$('aboutDialog').close());
  window.addEventListener('online',()=>{if(state.code)flushOutbox();refreshMyRooms(true);});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){if(state.code)markRead(state.code,0);refreshMyRooms();}});
  window.addEventListener('popstate',()=>{const code=new URLSearchParams(location.search).get('room');if(code)visitRoom(extractCode(code));else resetHome(false);});
}
(async function init(){
  setupEvents();
  if(DEMO){$('demoBanner').classList.remove('hidden');}
  const code=extractCode(new URLSearchParams(location.search).get('room') || '');
  renderMyRooms();
  if(code)await visitRoom(code);
  else if(DEMO && !indexedRooms().length){
    try{
      const examples=[['Friends Circle','Shadow','1d'],['Gaming Squad','Shadow','1d'],['University Project','Shadow','7d']];
      let first=null;
      for(const [title,nickname,duration] of examples){
        const data=await window.scaryDemoAPI('/api/rooms',{method:'POST',body:{title,nickname,duration,password:'',approvalRequired:false}});
        storeSet(tokenKey(data.code),data.token);
        rememberRoom(data.code,data.room,data.guest);
        if(title==='University Project')first=data.code;
      }
      if(first)await visitRoom(first);
    }catch(error){console.warn('Demo sample rooms unavailable:',error.message);}
  }
  refreshMyRooms();
  state.inboxTimer=setInterval(()=>{if(!document.hidden)refreshMyRooms();},60000);
})();
