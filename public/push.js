/* Optional push notifications for ScAry Project. No tracking; opt-in required. */
'use strict';
(()=>{
  const ENABLE_KEY='scary_project_push_enabled_v1';
  const muteKey=code=>'scary_project_push_muted_'+code;
  const previewKey=code=>'scary_project_push_preview_'+code;
  const $=id=>document.getElementById(id);
  const available=()=>window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const getFlag=key=>{try{return localStorage.getItem(key)==='1';}catch{return false;}};
  const setFlag=(key,value)=>{try{localStorage.setItem(key,value?'1':'0');}catch{}};
  const rooms=()=>{
    try {return (window.indexedRooms?.()||[]).filter(x=>x.code&&['active','pending'].includes(x.status||'active'))
      .map(x=>({code:x.code,token:window.storeGet?.(window.tokenKey(x.code))})).filter(x=>x.token);}
    catch{return [];}
  };
  let publicKey=null,ready=false,busy=false;
  const status=msg=>{const node=$('pushStatus');if(node)node.textContent=msg;};
  function render(){
    const btn=$('pushEnableButton');if(!btn)return;
    const enabled=getFlag(ENABLE_KEY);
    btn.title=enabled?'Disable notifications on this device':'Enable notifications';
    btn.setAttribute('aria-pressed',String(enabled));
    btn.classList.toggle('enabled',enabled);
    btn.setAttribute('aria-label',enabled?'Notifications enabled, click to disable':'Enable notifications');
    const text=$('pushEnableText');if(text)text.textContent=enabled?'Alerts on':'Enable alerts';
    const mute=$('pushMuteRoom'),preview=$('pushPreviewRoom');
    const code=window.scaryCurrentRoom?.();
    if(mute)mute.checked=!!code&&getFlag(muteKey(code));
    if(preview)preview.checked=!!code&&getFlag(previewKey(code));
    const roomEnabled=!!code&&enabled;
    if(mute)mute.disabled=!roomEnabled;
    if(preview)preview.disabled=!roomEnabled;
    if(!available()){status('Notifications require a supported HTTPS browser. On iPhone, add this site to your Home Screen.');return;}
    if(Notification.permission==='denied'){status('Notifications are blocked in browser settings.');return;}
    if(!ready){status('Notifications are not configured yet.');return;}
    status(enabled ? 'Notifications are on for this device. You can mute this room below.' : 'Enable alerts above to receive messages after closing the site.');
  }
  function b64urlBytes(text){
    const raw=atob(text.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-text.length%4)%4));
    return Uint8Array.from(raw,x=>x.charCodeAt(0));
  }
  async function registration(){return navigator.serviceWorker.register('/sw.js',{scope:'/'});}
  async function getSubscription(){
    const reg=await registration();
    return {reg,sub:await reg.pushManager.getSubscription()};
  }
  async function endpointRequest(code,token,body){
    const response=await fetch('/api/rooms/'+encodeURIComponent(code)+'/push',{
      method:'POST',credentials:'same-origin',cache:'no-store',
      headers:{'Content-Type':'application/json','X-Room-Token':token},body:JSON.stringify(body)
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||`Notification request failed (${response.status})`);
    return data;
  }
  async function syncRoom(code,token,subscription){
    if(!getFlag(ENABLE_KEY)||!subscription||!code||!token)return;
    await endpointRequest(code,token,{action:'subscribe',subscription:subscription.toJSON(),
      muted:getFlag(muteKey(code)),previewEnabled:getFlag(previewKey(code))});
  }
  async function syncRooms(subscription){
    let succeeded=0;
    for(const {code,token} of rooms()){
      try{await syncRoom(code,token,subscription);succeeded++;}catch(error){console.warn('[ScAry Push]',error.message);}
    }
    return succeeded;
  }
  async function enable(){
    if(busy)return;
    if(!available()){render();return;}
    if(!ready){render();return;}
    busy=true;
    try{
      // Permission request must be triggered directly by the person's click.
      const permission=Notification.permission==='granted' ? 'granted' : await Notification.requestPermission();
      if(permission!=='granted'){status('Notification permission was not granted.');return;}
      const {reg,sub:current}=await getSubscription();
      const sub=current||await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64urlBytes(publicKey)});
      setFlag(ENABLE_KEY,true);
      const synced=await syncRooms(sub);
      render();status(synced?`Notifications enabled for ${synced} room${synced===1?'':'s'}.`:'Notifications enabled. Join a room to receive alerts.');
    }catch(error){status('Could not enable notifications: '+error.message);}
    finally{busy=false;render();}
  }
  async function disable(){
    if(busy)return;busy=true;
    try{
      const {sub}=await getSubscription();
      // Remove records for known rooms before unsubscribing the browser endpoint.
      if(sub){
        for(const {code,token} of rooms()){
          try{await endpointRequest(code,token,{action:'unsubscribe',endpoint:sub.endpoint});}catch{}
        }
        await sub.unsubscribe();
      }
      setFlag(ENABLE_KEY,false);render();status('Notifications turned off on this device.');
    }catch(error){status('Could not disable notifications: '+error.message);}
    finally{busy=false;render();}
  }
  async function changePreference(code,kind,value){
    if(!code)return;
    setFlag(kind==='mute'?muteKey(code):previewKey(code),value);
    render();
    if(!getFlag(ENABLE_KEY))return;
    try{
      const {sub}=await getSubscription();
      const token=window.storeGet?.(window.tokenKey(code));
      if(!sub||!token)return;
      await endpointRequest(code,token,{action:'preferences',endpoint:sub.endpoint,
        muted:getFlag(muteKey(code)),previewEnabled:getFlag(previewKey(code))});
      status(kind==='mute'?(value?'This room is muted.':'This room is no longer muted.')
        :(value?'Message previews are visible on lock screens.':'Message previews are hidden.'));
    }catch(error){status('Could not save preference: '+error.message);}
  }
  window.ScAryPush={
    onRoomEnter(code,token){render();if(!getFlag(ENABLE_KEY)||!ready||!available())return;
      getSubscription().then(({sub})=>syncRoom(code,token,sub)).catch(error=>console.warn('[ScAry Push]',error.message));
    },
    onRoomExit(){render();},
    refresh:render,
  };
  async function init(){
    $('pushEnableButton')?.addEventListener('click',()=>getFlag(ENABLE_KEY)?disable():enable());
    $('pushMuteRoom')?.addEventListener('change',event=>changePreference(window.scaryCurrentRoom?.(),'mute',event.target.checked));
    $('pushPreviewRoom')?.addEventListener('change',event=>changePreference(window.scaryCurrentRoom?.(),'preview',event.target.checked));
    if(!available()){render();return;}
    if(new URLSearchParams(location.search).has('demo')){status('Notifications are unavailable in demo mode.');return;}
    try{
      const response=await fetch('/api/push/config',{cache:'no-store'});
      const data=await response.json();ready=!!data.configured;publicKey=data.publicKey||null;
      if(ready&&getFlag(ENABLE_KEY)&&Notification.permission==='granted'){
        const {sub}=await getSubscription();if(sub)await syncRooms(sub);
        else setFlag(ENABLE_KEY,false);
      }
    }catch{}
    render();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
