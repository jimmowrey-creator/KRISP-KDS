/* KRISP UI; never loaded by Chico Locker. */
'use strict';
const C=KrispCore,$=id=>document.getElementById(id),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const native=window.KrispNative;
const load=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}};
const randomId=()=>crypto.randomUUID?.()||Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('');
const device=localStorage.getItem('krisp-device')||randomId();localStorage.setItem('krisp-device',device);
let config=C.settings(load('krisp-settings',{station:new URLSearchParams(location.search).get('station')||'kitchen'}));
let storedEvents=load('krisp-events',[]);try{const saved=native?.readEvents?.();if(saved)storedEvents=JSON.parse(saved);}catch{}
let live=new C.Store(device,storedEvents),demoStore=new C.Store('demo-'+device,load('krisp-demo-events',[]));
let demo=false,station=config.station,history=false,page=0,lastUndo=null,detailKey=null,totalsOpen=false,unlockedUntil=0,pinResolve=null;
let status={ip:'Checking…',network:true,listening:true,station:config.station,port:C.ports[config.station],peers:[]},previousWarning='',storageError='';
let diagnostic=load('krisp-diagnostic',{}),lastSignature='';
const active=()=>demo?demoStore:live;
const now=()=>Date.now();
let messageTimer;
function message(text){$('message').textContent=text;$('message').hidden=!text;clearTimeout(messageTimer);if(text)messageTimer=setTimeout(()=>{$('message').hidden=true;},8000);}
function persist(){
 try{live.prune();if(native?.saveEvents){if(!native.saveEvents(JSON.stringify(live.events)))throw Error('Storage write failed');}else localStorage.setItem('krisp-events',JSON.stringify(live.events));localStorage.setItem('krisp-demo-events',JSON.stringify(demoStore.events));localStorage.setItem('krisp-diagnostic',JSON.stringify(diagnostic));storageError='';}
 catch(e){storageError='Storage is full. Keep this screen open and free tablet space; new orders may not survive a restart.';}
 native?.publish?.(JSON.stringify(live.events));
}
// Carry existing KRISP orders into the new model without touching Chico's app sandbox.
if(!localStorage.getItem('krisp-migrated')){
 for(const old of load('jim-native-orders',[])){
  for(const s of Object.keys(old.states||{}).filter(s=>C.stations.includes(s))){
   const e=live.append({kind:'print',orderKey:C.identity(old.rawText||'',old,old.source||'P18',old.createdAt||now())?.key||'legacy:'+old.id,station:s,at:old.createdAt||now(),source:old.source||'P18',provider:'P18',mode:old.cancelledAt?'void':'snapshot',payload:{number:old.number,type:old.type,metadata:old.metadata||{},notes:old.notes||[],items:(old.items||[]).filter(i=>i.station===s).map(i=>({...i,qty:+i.qty||1,modifiers:i.modifiers||[]})),rawText:old.rawText||''}});
   if(old.states[s]==='COMPLETE')live.action(e.orderKey,s,'complete',{},old.completedAt?.[s]||now());
  }
 }
 persist();if(!storageError)localStorage.setItem('krisp-migrated','1');
}
function elapsed(o,s){const end=history?o.completedAt?.[s]||now():now();const seconds=Math.max(0,Math.floor((end-o.createdAt)/1000));return Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');}
function isVisible(o){return Object.entries(o.states).some(([s,value])=>(station==='expo'||s===station)&&(history?value==='COMPLETE':value!=='COMPLETE'));}
function modifier(m){const special=/\b(?:ALLERG(?:Y|IC|EN)|NO|EXTRA|WITHOUT)\b/i.test(m);return '<div class="modifier '+(special?'important':'')+'">'+esc(m)+'</div>';}
function ticket(o,detail=false){
 const visible=C.stations.filter(s=>o.states[s]&&(station==='expo'||station===s));
 const late=visible.some(s=>(now()-o.createdAt)/60000>=config.timers[s].late),warn=visible.some(s=>(now()-o.createdAt)/60000>=config.timers[s].warning);
 const unavailable=!demo&&(storageError||status.network===false||status.listening===false&&config.station!=='expo');
 const additions=o.items.some(i=>visible.includes(i.station)&&i.addedQty);
 return `<article data-ticket="${esc(o.key)}" class="ticket ${additions?'has-addon ':''}${o.voided?'voided':history?'':late?'late':warn?'warn':''}"><div class="ticket-head"><div><strong>#${esc(o.number)}</strong>${additions?'<span class="tag">ADD-ON</span>':''}<div class="meta">${esc(o.type)} · ${esc(o.provider)}</div><div class="meta">${esc(o.customer||o.source||'P18')}</div></div><span class="timer">${elapsed(o,visible[0])}</span></div>
 ${o.voided?'<div class="void-banner">VOIDED — DO NOT PREPARE</div>':''}
 <div class="station-badges">${Object.entries(o.states).map(([s,state])=>`<span class="station-badge ${state==='COMPLETE'?'ready':''}">${esc(s)}: ${state==='COMPLETE'?'ready':'waiting'}</span>`).join('')}</div>
 <div class="ticket-body">${o.review?'<div class="review">VERIFY ON P18 — see original print</div>':''}${o.notes.map(n=>`<div class="note ${/allerg/i.test(n)?'allergy':''}">${esc(n)}</div>`).join('')}
 ${o.items.filter(i=>visible.includes(i.station)).map(i=>`<div class="item ${i.done?'done':''} ${i.addedQty?'addon':''} ${i.changed?'change':''} ${i.removed?'removed':''}">${i.addedQty?`<span class="tag">ADD-ON +${i.addedQty}</span>`:''}${i.changed?'<span class="tag">P18 CHANGE</span>':''}${i.removed?'<span class="tag">REMOVED ON P18</span>':''}<div class="item-name"><input type="checkbox" aria-label="Prepared ${esc(i.name)}" data-action="item" data-order="${esc(o.key)}" data-station="${i.station}" data-item="${esc(i.id)}" ${i.done?'checked':''} ${o.voided||i.removed||history||unavailable?'disabled':''}><strong>${i.qty} × ${esc(i.name)}</strong></div>${station==='expo'?`<div class="meta">${i.station.toUpperCase()}</div>`:''}${i.modifiers.map(modifier).join('')}</div>`).join('')||'<p>No item details in this print. Verify on P18.</p>'}
 ${detail?Object.entries(o.raw).map(([s,raw])=>`<details><summary>Original P18 print — ${s}</summary><pre>${esc(raw)}</pre></details>`).join(''):''}</div>
 <div class="ticket-actions"><button data-action="details" data-order="${esc(o.key)}">Details</button>${visible.filter(s=>history?o.states[s]==='COMPLETE':o.states[s]!=='COMPLETE').map(s=>`<button class="complete" data-action="${history?'recall':'complete'}" data-station="${s}" data-order="${esc(o.key)}" ${unavailable||history&&o.voided?'disabled':''}>${history?'Recall':o.voided?'Acknowledge void':'Complete'}${station==='expo'?' '+s:''}</button>`).join('')}
 ${o.items.some(i=>visible.includes(i.station)&&(i.addedQty||i.changed))?visible.map(s=>`<button data-action="ack" data-station="${s}" data-order="${esc(o.key)}">Seen changes${station==='expo'?' '+s:''}</button>`).join(''):''}
 ${history&&Object.values(o.states).every(v=>v==='COMPLETE')?`<button data-action="delete" data-station="${visible[0]}" data-order="${esc(o.key)}">Delete</button>`:''}</div></article>`;
}
function render(force=false){
 const store=active(),orders=store.orders().filter(isVisible),count=Math.max(1,orders.length);
 page=0;
 for(const article of document.querySelectorAll('[data-ticket]')){const order=store.orders().find(o=>o.key===article.dataset.ticket);if(order){const s=C.stations.find(s=>order.states[s]&&(station==='expo'||station===s));article.querySelector('.timer').textContent=elapsed(order,s);}}
 $('undo').disabled=!lastUndo||lastUndo.demo!==demo||now()-lastUndo.at>30000;
 const signature=JSON.stringify([store.events.length,live.events.length,demo,station,history,page,config,Math.floor(now()/60000),status,storageError]);
 if(!force&&signature===lastSignature)return;lastSignature=signature;
 // Timers update in place; preserve scroll positions when order data changes.
 const boardScroll=$('board').scrollLeft;
 const scroll=new Map([...$('board').querySelectorAll('.ticket-body')].map((el,n)=>[n,el.scrollTop]));
 $('board').style.setProperty('--columns',config.columns);$('board').style.setProperty('--rows',config.rows);$('board').style.setProperty('--ticket-font',config.font+'px');
 $('board').classList.toggle('dense',config.rows>=3||config.columns>=5);
 $('board').innerHTML=orders.map(o=>ticket(o)).join('')||`<div class="empty"><h2>${history?'Nothing to recall':'Ready for the next order'}</h2><p>${demo?'DEMO — sample orders only':'Orders arrive from the P18.'}</p></div>`;
 $('board').querySelectorAll('.ticket-body').forEach((el,n)=>el.scrollTop=scroll.get(n)||0);
 $('board').scrollLeft=boardScroll;
 $('stations').innerHTML=['expo',...C.stations].map(s=>`<button data-view="${s}" class="${station===s?'selected':''}">${s==='expo'?'All / Expo':s[0].toUpperCase()+s.slice(1)}</button>`).join('');
 $('summary').textContent=`${orders.length} ${history?'completed':'active'} orders · Oldest first`;
 $('pages').textContent='Swipe';$('previous').disabled=true;$('next').disabled=true;
 $('history').classList.toggle('selected',history);$('undo').disabled=!lastUndo||lastUndo.demo!==demo||now()-lastUndo.at>30000;
 $('demo-banner').hidden=!demo;$('demo-banner').textContent=`DEMO MODE — sample orders only · ${live.orders().filter(o=>Object.values(o.states).some(s=>s!=='COMPLETE')).length} real orders waiting`;
 const warnings=[];if(storageError)warnings.push(storageError);if(status.syncError)warnings.push(status.syncError);if(status.network===false)warnings.push('Network disconnected — P18 orders cannot arrive.');if(status.listening===false&&config.station!=='expo')warnings.push('Receiver stopped — '+(status.error||'check the receiving port.'));
 if(config.station==='expo'&&!(status.peers||[]).some(p=>p.ok))warnings.push('No prep tablets connected — Expo status may be stale.');
 if((status.peers||[]).some(p=>!p.ok))warnings.push('Station sharing interrupted — remote station status may be stale.');
 const warning=warnings.join(' ');$('connection-warning').hidden=!warning;$('connection-warning').textContent=warning;
 if(warning&&warning!==previousWarning&&config.sounds)native?.playAlert?.('warning');previousWarning=warning;
 $('health').textContent=demo?'Demo display · live receiver stays on':config.station==='expo'?'Expo station':`${status.network===false||status.listening===false?'Receiver needs attention':'Receiver ready'} · ${status.ip}${status.port?':'+status.port:''}`;
 $('last-order').textContent=diagnostic.at?'Last P18 print: '+new Date(diagnostic.at).toLocaleTimeString()+' · '+(diagnostic.result||'received'):'No P18 orders received yet';
 $('peers-status').textContent=(status.peers||[]).length?status.peers.map(p=>p.host+': '+(p.ok?'connected':p.error||'unavailable')).join(' · '):'Standalone station';
 if($('detail').open){if(totalsOpen)renderTotals();else {const o=store.orders().find(o=>o.key===detailKey);if(o)$('detail-body').innerHTML=ticket(o,true);else $('detail').close();}}
}
function renderTotals(){const items=C.totals(active().orders(),station);$('detail-title').textContent='Outstanding item totals';$('detail-body').innerHTML=items.map(i=>`<div class="total-item"><strong>${i.qty} × ${esc(i.name)}</strong><div class="meta">${esc(i.station)}</div>${i.modifiers.map(modifier).join('')}</div>`).join('')||'<p>No outstanding items.</p>';}
function commit(){persist();render(true);}
window.receiveNativePrint=function(base64,source,receivingStation='kitchen'){
 try{
  const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));let text;
  if(new TextDecoder().decode(bytes.subarray(0,5))==='POST '){const request=new TextDecoder().decode(bytes),payload=JSON.parse(request.slice(request.indexOf('\r\n\r\n')+4));text=String(payload.receipt||'').replace(/<BR\s*\/?>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');}
  else text=decode(bytes).text;
  if(!text.trim()||isSalesReceipt(text))return false;
  const parsed=parseTicket(text,receivingStation,NATIVE_CONFIG);parsed.items=parsed.items.map(i=>({...i,station:receivingStation,modifiers:i.modifiers.flatMap(modifierLines)}));
  const result=live.ingest(parsed,text,source,receivingStation,config);diagnostic={at:now(),source,result:result.kind,bytes:bytes.length,order:parsed.number};
  commit();if(result.kind==='duplicate')message('Identical reprint ignored for order #'+parsed.number);else if(demo)message('Real P18 order received while demo is open. Exit demo to see it.');
  return config.sounds&&result.kind!=='duplicate'&&result.kind!=='ignored'?result.kind:false;
 }catch(e){diagnostic={at:now(),result:'Print processing failed: '+e.message};message('Print could not be processed. Check the P18 and resend the kitchen ticket.');return false;}
};
window.krispNativeStatus=function(value){status={...status,...value};render();};
window.krispPeerEvents=function(events){const known=new Set(live.events.map(e=>e.id));if(Array.isArray(events)&&live.merge(events)){commit();const prints=events.filter(e=>!known.has(e.id)&&C.validEvent(e)&&e.kind==='print'&&now()-e.at<60000);if(prints.length&&config.sounds)native?.playAlert?.(prints.some(e=>e.mode==='void')?'void':prints.some(e=>e.mode==='delta')?'addon':'new');}};
document.addEventListener('click',async e=>{
 const b=e.target.closest('[data-action],[data-view],[data-close],[data-sound]');if(!b)return;
 if(b.dataset.close){$(b.dataset.close).close();return;}
 if(b.dataset.sound){native?.playAlert?.(b.dataset.sound);return;}
 if(b.dataset.view){station=b.dataset.view;page=0;render(true);return;}
 const {action,order:key,station:s}=b.dataset,o=active().orders().find(o=>o.key===key);if(!o)return;
 if(action==='details'){totalsOpen=false;detailKey=key;$('detail-title').textContent='Order #'+o.number;$('detail-body').innerHTML=ticket(o,true);$('detail').showModal();return;}
 if(action==='delete'&&!confirm('Permanently delete this completed order from paired KRISP tablets?'))return;
 const details={};if(action==='item'){const i=o.items.find(i=>i.id===b.dataset.item);if(!i)return;details.item=i.id;details.revision=i.revision;details.done=b.checked;}
 const event=active().action(key,s,action,details);if(action==='complete')lastUndo={id:event.id,key,station:s,at:now(),demo};commit();
});
$('history').onclick=()=>{history=!history;page=0;render(true);};$('previous').onclick=()=>{page--;render(true);};$('next').onclick=()=>{page++;render(true);};
$('totals').onclick=()=>{totalsOpen=true;renderTotals();$('detail').showModal();};
$('undo').onclick=()=>{if(lastUndo&&lastUndo.demo===demo&&now()-lastUndo.at<=30000){active().action(lastUndo.key,lastUndo.station,'undo',{target:lastUndo.id});lastUndo=null;commit();message('Completion undone.');}};
$('fullscreen').onclick=()=>document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen().catch(()=>message('Use the tablet full-screen control.'));
async function pinHash(pin,salt){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(pin),'PBKDF2',false,['deriveBits']);const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:new TextEncoder().encode(salt),iterations:120000,hash:'SHA-256'},key,256);return Array.from(new Uint8Array(bits),x=>x.toString(16).padStart(2,'0')).join('');}
function askPin(title){$('pin-title').textContent=title;$('pin-entry').value='';$('pin-error').textContent='';$('pin-dialog').showModal();$('pin-entry').focus();return new Promise(resolve=>pinResolve=resolve);}
$('pin-form').onsubmit=e=>{e.preventDefault();const value=$('pin-entry').value;$('pin-dialog').close();pinResolve?.(value);pinResolve=null;};
$('pin-dialog').addEventListener('close',()=>{if(pinResolve){pinResolve(null);pinResolve=null;}});
async function unlock(){
 const lock=load('krisp-pin',null);if(!lock||now()<unlockedUntil)return true;
 const attempts=load('krisp-pin-attempts',{count:0,until:0});if(now()<attempts.until){message('Too many PIN attempts. Try again in one minute.');return false;}
 const pin=await askPin('Manager PIN');if(pin===null)return false;
 if(await pinHash(pin,lock.salt)!==lock.hash){attempts.count++;if(attempts.count>=5){attempts.until=now()+60000;attempts.count=0;}localStorage.setItem('krisp-pin-attempts',JSON.stringify(attempts));message('Incorrect manager PIN.');return false;}
 localStorage.removeItem('krisp-pin-attempts');unlockedUntil=now()+300000;return true;
}
const serviceLinks=[['DoorDash','https://developer.doordash.com/en-US/docs/marketplace/overview/getting_started/requesting_access/'],['Grubhub','https://get.grubhub.com/products/tech-integrations/'],['Slice','https://developer.slicelife.com/'],['Uber Eats','https://developer.uber.com/docs/eats/introduction'],['ChowNow','https://get.chownow.com/']];
function openSettings(){
 for(const key of ['columns','rows','font','station','updateMode','duplicateSeconds','peers','groupKey'])$(key).value=config[key];$('sounds').checked=config.sounds;
 $('timer-settings').innerHTML=C.stations.map(s=>`<div class="timer-row"><strong>${s}</strong><label>Warning<input id="${s}-warning" type="number" min="1" max="120" value="${config.timers[s].warning}" required></label><label>Late<input id="${s}-late" type="number" min="1" max="240" value="${config.timers[s].late}" required></label></div>`).join('');
 $('delivery-services').innerHTML=serviceLinks.map(([name,url])=>`<div class="service"><strong>${name}</strong><span>Not connected — provider access required</span><div><a href="${url}" target="_blank" rel="noopener noreferrer">Provider information</a></div></div>`).join('');
 $('pin-status').textContent=load('krisp-pin',null)?'Manager PIN is enabled.':'No manager PIN set.';$('demo-toggle').textContent=demo?'Exit demo':'Start demo';for(const id of ['demo-sample','demo-addon','demo-void'])$(id).disabled=!demo;
 $('receiver-address').textContent=config.station==='expo'?'Expo receives shared station updates.':`P18 destination: ${status.ip}:${C.ports[config.station]} — ${config.station.toUpperCase()}`;
 $('diagnostics').textContent=JSON.stringify({receiver:status,lastPrint:diagnostic},null,2);$('settings-dialog').showModal();
}
$('settings').onclick=async()=>{if(await unlock())openSettings();};
$('generate-key').onclick=()=>{$('groupKey').value=randomId();$('groupKey').type='text';$('show-key').checked=true;};$('show-key').onchange=()=>{$('groupKey').type=$('show-key').checked?'text':'password';};
$('settings-form').onsubmit=e=>{
 e.preventDefault();const next={};for(const key of ['columns','rows','font','station','updateMode','duplicateSeconds','peers','groupKey'])next[key]=$(key).value;next.sounds=$('sounds').checked;
 next.timers=Object.fromEntries(C.stations.map(s=>[s,{warning:+$(s+'-warning').value,late:+$(s+'-late').value}]));
 if(Object.values(next.timers).some(t=>t.late<t.warning)){message('Late time must be at least the warning time.');return;}
 const hosts=next.peers.split(/[\s,]+/).filter(Boolean);if(hosts.length>8||hosts.some(ip=>!privateIp(ip))){message('Enter up to eight private Wi-Fi IPv4 addresses.');return;}
 if(hosts.length&&next.groupKey.length<16||next.groupKey.length>128||/[^\x20-\x7e]/.test(next.groupKey)){message('Use a pairing code of 16–128 letters, numbers or punctuation on every tablet.');return;}
 config=C.settings(next);station=config.station;localStorage.setItem('krisp-settings',JSON.stringify(config));native?.configure?.(JSON.stringify(config));page=0;$('settings-dialog').close();render(true);message('Settings saved.');
};
function privateIp(ip){const p=ip.split('.').map(Number);return p.length===4&&p.every(n=>Number.isInteger(n)&&n>=0&&n<=255)&&(p[0]===10||p[0]===192&&p[1]===168||p[0]===172&&p[1]>=16&&p[1]<=31);}
$('change-pin').onclick=async()=>{if(!await unlock())return;const pin=await askPin('New manager PIN (4–8 digits)');if(pin===null)return;const again=await askPin('Confirm new manager PIN');if(pin!==again){message('PINs did not match.');return;}const salt=randomId();try{const hash=await pinHash(pin,salt);localStorage.setItem('krisp-pin',JSON.stringify({salt,hash}));unlockedUntil=0;$('pin-status').textContent='Manager PIN is enabled.';message('Manager PIN saved.');}catch{message('PIN protection is unavailable in this browser. Use the installed Android app.');}};
function sampleDemo(){
 const number=String(100+demoStore.events.filter(e=>e.kind==='print').length),text=`ORDER #${number}\n1 x Burger\n> NO ONION\n> ALLERGY: sesame`;
 demoStore.ingest({number,type:'DEMO — dine in',metadata:{customer:'Demo guest'},items:[{name:'Burger',qty:1,modifiers:['NO ONION','ALLERGY: sesame']}],notes:[]},text,'Demo P18','kitchen',config);
 demoStore.ingest({number,type:'DEMO — dine in',items:[{name:'Garden salad',qty:1,modifiers:['Dressing on side']}],notes:[]},`ORDER #${number}\n1 x Garden salad\n> Dressing on side`,'Demo P18','salad',config);
 commit();
}
$('demo-addon').onclick=()=>{if(!demo)return;const o=demoStore.orders().find(o=>!o.voided);if(!o){message('Add a demo order first.');return;}const items=o.items.filter(i=>i.station==='kitchen'&&!i.removed).map(i=>({name:i.name,qty:i.qty,modifiers:i.modifiers}));items.push({name:'Fries',qty:1,modifiers:['EXTRA crispy']});demoStore.ingest({number:o.number,type:'DEMO — dine in',items,notes:[]},`ORDER #${o.number}\nDemo updated order ${now()}`,'Demo P18','kitchen',{...config,updateMode:'snapshot'});station='kitchen';history=false;commit();$('settings-dialog').close();};
$('demo-void').onclick=()=>{if(!demo)return;const o=demoStore.orders().find(o=>!o.voided);if(!o){message('Add a demo order first.');return;}demoStore.ingest({number:o.number,items:[],notes:[]},`VOID ORDER #${o.number}`,'Demo P18','kitchen',config);station='kitchen';history=false;commit();$('settings-dialog').close();};
$('demo-toggle').onclick=()=>{demo=!demo;history=false;page=0;lastUndo=null;if(demo&&!demoStore.events.length)sampleDemo();$('settings-dialog').close();render(true);};$('demo-sample').onclick=()=>{if(demo){sampleDemo();$('settings-dialog').close();}};
if(!native&&new URLSearchParams(location.search).get('demo')==='1'){demo=true;if(!demoStore.events.length)sampleDemo();}
native?.configure?.(JSON.stringify(config));persist();render(true);setInterval(()=>render(),1000);setInterval(()=>persist(),60000);
