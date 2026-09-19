/* KRISP-only event model. Shared print/parser code and Chico assets stay unchanged. */
(function(root){
'use strict';
const stations=['kitchen','bar','salad','dessert'];
const ports={kitchen:9100,bar:9101,salad:9102,dessert:9103};
const clone=x=>JSON.parse(JSON.stringify(x));
const clean=s=>String(s??'').replace(/\s+/g,' ').trim();
const signature=i=>JSON.stringify([clean(i.name).toUpperCase(),(i.modifiers||[]).map(m=>clean(m).toUpperCase())]);
const defaults={columns:3,rows:1,station:'kitchen',font:19,sounds:true,peers:'',groupKey:'',updateMode:'snapshot',duplicateSeconds:120,timers:Object.fromEntries(stations.map(s=>[s,{warning:5,late:10}]))};
function settings(value={}){
 const v={...clone(defaults),...value},integer=(n,min,max,fallback)=>Number.isInteger(+n)&&+n>=min&&+n<=max?+n:fallback;
 v.columns=integer(v.columns,1,8,3);v.rows=integer(v.rows,1,4,1);v.font=integer(v.font,14,32,19);
 if(![...stations,'expo'].includes(v.station))v.station='kitchen';
 v.updateMode=v.updateMode==='delta'?'delta':'snapshot';
 v.duplicateSeconds=integer(v.duplicateSeconds,10,600,120);
 v.sounds=v.sounds!==false;v.peers=String(v.peers||'');v.groupKey=String(v.groupKey||'');
 v.timers=Object.fromEntries(stations.map(s=>{const t=value.timers?.[s]||{};const warning=integer(t.warning,1,120,5);return[s,{warning,late:integer(t.late,warning,240,Math.max(10,warning))}];}));
 return v;
}
function identity(text,parsed,source,now){
 const match=text.match(/^\s*(?:OrderId|(?:ORDER|TICKET|CHECK)(?:\s*(?:NO\.?|NUMBER|#|:))?)\s*[:#]?\s*([\w-]+)\s*$/mi);
 const controlNumber=text.match(/^\s*(?:VOID(?:ED)?|CANCEL(?:LED|ED))\s+(?:ORDER|CHECK|TICKET)\s*[:#]?\s*([\w-]+)\s*$/mi)?.[1]||text.match(/^\s*(?:ORDER|CHECK|TICKET)\s*[:#]?\s*([\w-]+)\s+(?:VOID(?:ED)?|CANCEL(?:LED|ED))\s*$/mi)?.[1];
 const number=controlNumber||match?.[1]||parsed.number;
 if(!number||number==='PRINT'||/^(?:VOID|VOIDED|CANCELLED|CANCELED|ADD)$/i.test(number))return null;
 const day=text.match(/^\s*(\d{1,2}\/\d{1,2}\/\d{2,4})\b/m)?.[1]||new Date(now).toLocaleDateString('en-US');
 const dateParts=day.split('/').map(Number);if(dateParts[2]<100)dateParts[2]+=2000;
 const date=dateParts.join('-');
 const terminal=clean(parsed.metadata?.['pos number']||source);
 return {key:JSON.stringify([terminal,date,number]),number,terminal,date};
}
function control(text){
 // Require a whole-order header, never interpret "VOID ITEM" or a modifier as a full void.
 const lines=text.split(/\r?\n/).map(s=>s.trim());
 if(lines.some(s=>/^(?:(?:ORDER|TICKET|CHECK)\s+(?:VOID(?:ED)?|CANCEL(?:LED|ED))|(?:VOID(?:ED)?|CANCEL(?:LED|ED))\s+(?:ORDER|TICKET|CHECK))(?:\s*[:#]?\s*[\w-]+)?$/i.test(s)||/^(?:ORDER|TICKET|CHECK)\s*[:#]?\s*[\w-]+\s+(?:VOID(?:ED)?|CANCEL(?:LED|ED))$/i.test(s)||/^(?:VOIDED|ORDER CANCELLED|ORDER CANCELED)$/i.test(s)))return 'void';
 if(lines.some(s=>/^(?:ADD[ -]?ON|ADDITIONAL ITEMS|ADDED ITEMS)(?:\s+FOR\s+(?:ORDER|CHECK)\s*#?\s*[\w-]+)?\s*:?$/i.test(s)))return 'addon';
 return 'snapshot';
}
function provider(text){
 // A source label is not an API connection. Read explicit receipt headings only.
 const lines=text.split(/\r?\n/).map(s=>s.trim());
 for(const [name,re] of [['DoorDash',/door\s*dash/i],['Grubhub',/grub\s*hub/i],['Slice',/^slice$/i],['Uber Eats',/uber\s*eats/i],['ChowNow',/chow\s*now/i]]){
  if(lines.some(s=>re.test(s.replace(/^(?:source|channel|platform)\s*:\s*/i,''))&&(/^(?:source|channel|platform)\s*:/i.test(s)||s.length<=20)))return name;
 }
 return 'P18';
}
function validEvent(e){
 if(!e||typeof e.id!=='string'||e.id.length>150||typeof e.orderKey!=='string'||e.orderKey.length>500||!Number.isSafeInteger(e.clock)||e.clock<0||!Number.isFinite(e.at)||!['print','complete','item','recall','undo','delete','ack'].includes(e.kind))return false;
 if(!stations.includes(e.station))return false;
 if(e.kind==='print')return !!(e.payload&&Array.isArray(e.payload.items)&&e.payload.items.length<=500&&e.payload.items.every(i=>i&&typeof i.name==='string'&&i.name.length<1000&&Number.isFinite(i.qty)&&i.qty>0&&i.qty<=9999&&Array.isArray(i.modifiers)&&i.modifiers.length<=200&&i.modifiers.every(m=>typeof m==='string'&&m.length<=2000))&&(e.payload.notes===undefined||Array.isArray(e.payload.notes)&&e.payload.notes.length<=500&&e.payload.notes.every(n=>typeof n==='string'&&n.length<=4000))&&(e.payload.metadata===undefined||e.payload.metadata!==null&&typeof e.payload.metadata==='object'&&!Array.isArray(e.payload.metadata))&&typeof e.payload.rawText==='string'&&e.payload.rawText.length<=1048576&&['snapshot','delta','void','review'].includes(e.mode));
 if(e.kind==='complete'&&e.revisions!==undefined&&(!Array.isArray(e.revisions)||!e.revisions.every(v=>typeof v==='string')))return false;
 if(e.kind==='item'&&(typeof e.item!=='string'||typeof e.revision!=='string'||typeof e.done!=='boolean'))return false;
 return e.kind!=='undo'||typeof e.target==='string';
}
function itemRows(payload,station,event){
 const map=new Map();
 for(const i of payload.items){const sig=signature(i);if(map.has(sig))map.get(sig).qty+=i.qty;else map.set(sig,{...clone(i),id:station+':'+sig,station,qty:i.qty,addedQty:0,done:false,signature:sig,revision:event.id});}
 return [...map.values()];
}
// Item voids require an explicit label and an unambiguous existing item.
// Keep this in reconciliation so the shared P18 parser and event wire format stay intact.
function itemVoids(text,previous){
 const lines=text.split(/\r?\n/).map(clean),targets=new Map();let removedSection=false;
 for(let n=0;n<lines.length;n++){
  if(/^Removed\s*:?$/i.test(lines[n])){removedSection=true;continue;}
  if(removedSection&&(!lines[n]||lines[n]==='.'))continue;
  // Observed P18 removal receipt: Removed / - 1.0 x REG COLD SANDWICH.
  const removed=removedSection&&lines[n].match(/^-\s*(\d+(?:\.\d+)?)\s+x\s+(.+)$/i);
  if(removedSection&&!removed)return null;
  const match=removed?[null,removed[1]+' x '+removed[2]]:lines[n].match(/^(?:(?:VOID(?:ED)?|CANCEL(?:LED|ED)?)\s+ITEM|ITEM\s+(?:VOID(?:ED)?|CANCEL(?:LED|ED)?))\s*:?\s*(.*)$/i);
  if(!match)continue;
  let label=match[1];
  if(!label){label=lines[++n]||'';if(!/^\d+\s+(?:x\s+)?\S/i.test(label))return null;}
  const quantity=label.match(/^(\d+(?:\.\d+)?)\s+(?:x\s+)?(.+)$/i);
  const name=clean(quantity?quantity[2]:label).toUpperCase(),mods=[];
  while(/^>\s*\S/.test(lines[n+1]||''))mods.push(lines[++n].replace(/^>\s*/,''));
  const matches=previous.filter(i=>clean(i.name).toUpperCase()===name&&(!mods.length||signature(i)===signature({name,modifiers:mods})));
  if(matches.length!==1)return null;
  const item=matches[0],qty=quantity?Number(quantity[1]):item.qty;
  const total=(targets.get(item.id)||0)+qty;
  if(qty<=0||total>item.qty)return null;
  targets.set(item.id,total);
 }
 return targets.size?targets:null;
}
function reduce(events){
 const sorted=[...events].sort((a,b)=>a.clock-b.clock||a.id.localeCompare(b.id));
 const completions=new Map(sorted.filter(e=>e.kind==='complete').map(e=>[e.id,e]));
 const undone=new Set(sorted.filter(e=>e.kind==='undo'&&completions.get(e.target)?.orderKey===e.orderKey&&completions.get(e.target)?.station===e.station).map(e=>e.target));
 const orders=new Map(),deleted=new Set(sorted.filter(e=>e.kind==='delete').map(e=>e.orderKey));
 for(const e of sorted){
  if(e.kind==='undo'||undone.has(e.id)||deleted.has(e.orderKey))continue;
  let o=orders.get(e.orderKey),matchedPrecheck=false;
  if(e.kind==='print'){
   // Precheck omits POS number; a subsequent kitchen removal includes it. Match
   // only one recent active Precheck from the same printer source and order.
   // Arrival age permits a midnight crossing without merging old reused numbers.
   if(!o&&/^\s*Removed\s*:?\s*$/mi.test(e.payload.rawText)){
    const incoming=identity(e.payload.rawText,e.payload,e.source,e.at);
    const candidates=incoming?[...orders.values()].filter(p=>!p.voided&&p.number===incoming.number&&clean(p.source)===clean(e.source)&&clean(e.source)&&e.at>=p.createdAt&&e.at-p.createdAt<=4*3600000&&p.states[e.station]&&p.states[e.station]!=='COMPLETE'&&p.precheckStations?.includes(e.station)&&(!p.precheckTerminal?.[e.station]||p.precheckTerminal[e.station]===incoming.terminal)):[];
    if(candidates.length===1&&itemVoids(e.payload.rawText,candidates[0].items.filter(i=>i.station===e.station&&!i.removed))){o=candidates[0];matchedPrecheck=true;if(e.payload.metadata?.['pos number']){o.precheckTerminal||={};o.precheckTerminal[e.station]=incoming.terminal;}}
   }
   if(!o){o={key:e.orderKey,number:e.payload.number||'PRINT',createdAt:e.at,updatedAt:e.at,source:e.source,provider:e.provider||'P18',type:e.payload.type||'Kitchen ticket',customer:e.payload.metadata?.customer||'',states:{},items:[],notes:[],raw:{},events:[],voided:false,review:false};orders.set(e.orderKey,o);}
   if(o.deleted)continue;
   const station=e.station,previous=o.items.filter(i=>i.station===station&&!i.removed);
   if(!o.raw[station]&&/^\s*PRECHECK\s*$/mi.test(e.payload.rawText)&&!e.payload.metadata?.['pos number'])o.precheckStations=[...(o.precheckStations||[]),station];
   o.updatedAt=Math.max(o.updatedAt,e.at);o.raw[station]=e.payload.rawText;o.events.push(e.id);
   o.lastPrint||={};o.lastPrint[station]=e.id;
   o.notes=[...new Set([...o.notes,...(e.payload.notes||[])])];o.states[station]||='NEW';
   if(e.mode==='review'||/^\s*Removed\s*:?\s*$/mi.test(e.payload.rawText)){
    const voids=!o.voided&&(matchedPrecheck||identity(e.payload.rawText,e.payload,e.source,e.at)?.key===e.orderKey)&&itemVoids(e.payload.rawText,previous);
    o.states[station]='NEW';
    if(voids){
     // Successfully reconciled control lines are not kitchen confirmation notes.
     o.notes=o.notes.filter(n=>!/^Removed\s*:?$/i.test(clean(n))&&!/^-\s*\d+(?:\.\d+)?\s+x\s+/i.test(clean(n)));
     for(const i of previous)if(voids.has(i.id)){
      const remaining=i.qty-voids.get(i.id);
      i.removed=remaining===0;if(remaining)i.qty=remaining;
      i.done=false;i.changed=true;i.addedQty=0;i.revision=e.id;
     }
    }else{o.review=true;o.notes.push(e.reason||'Print could not be matched safely. Verify on P18.');}
    continue;
   }
   if(e.mode==='void'){
    o.voided=true;o.voidedAt=e.at;
    for(const s of Object.keys(o.states)){o.states[s]='NEW';o.lastPrint[s]=e.id;}
    o.items.forEach(i=>{i.revision=e.id;i.done=false;i.addedQty=0;i.changed=false;});
    if(!o.items.length)o.items=itemRows(e.payload,station,e);
    continue;
   }
   if(o.voided){o.review=true;o.notes.push('Print received after void. Verify on P18 before preparing.');continue;}
   let next=itemRows(e.payload,station,e),changed=false;
   if(e.mode==='delta'){
    next=previous.map(clone);
    for(const add of itemRows(e.payload,station,e)){
     const existing=next.find(i=>i.signature===add.signature);
     if(existing){existing.qty+=add.qty;existing.addedQty+=add.qty;existing.done=false;existing.revision=e.id;}
     else next.push({...add,addedQty:add.qty});
     changed=true;
    }
   }else{
    const hadStation=o.printedStations?.includes(station);
    next=next.map(i=>{
     const old=previous.find(p=>p.signature===i.signature);
     // A smaller partial print is not evidence that units were cancelled.
     if(old)i.qty=Math.max(i.qty,old.qty);
     const diff=i.qty-(old?.qty||0);
     if(!old||diff!==0)changed=true;
     return {...i,done:old?.done&&diff<=0||false,addedQty:hadStation?Math.max(0,diff):0,changed:hadStation&&diff<0,revision:old&&diff===0?old.revision:e.id};
    });
    // P18 may print only the added items. Omission must preserve the existing row.
    for(const old of previous)if(!next.some(i=>i.signature===old.signature))next.push(clone(old));
   }
   for(const old of o.items.filter(i=>i.station===station&&i.removed))if(!next.some(i=>i.signature===old.signature))next.push(clone(old));
   o.items=o.items.filter(i=>i.station!==station).concat(next);
   o.printedStations=[...new Set([...(o.printedStations||[]),station])];
   if(changed)o.states[station]='NEW';
   o.review ||= !!e.payload.needsReview&&!e.payload.items.length;
  }else if(o&&!o.deleted){
   if(e.kind==='delete'){if(Object.values(o.states).every(s=>s==='COMPLETE'))o.deleted=true;}
   if(e.kind==='ack'&&(!e.basis||e.basis===o.lastPrint?.[e.station])){o.items.filter(i=>i.station===e.station).forEach(i=>{i.addedQty=0;i.changed=false;});}
   if(e.kind==='complete'&&(!e.basis||e.basis===o.lastPrint?.[e.station])&&(!e.revisions||o.items.filter(i=>i.station===e.station&&!i.removed).every(i=>e.revisions.includes(i.revision)))){
    o.states[e.station]='COMPLETE';o.items.filter(i=>i.station===e.station).forEach(i=>i.done=true);o.completedAt||={};o.completedAt[e.station]=e.at;
   }
   if(e.kind==='recall'){o.states[e.station]='NEW';o.items.filter(i=>i.station===e.station).forEach(i=>i.done=false);}
   if(e.kind==='item'&&!o.voided){const i=o.items.find(i=>i.id===e.item&&i.revision===e.revision);if(i&&!i.removed)i.done=!!e.done;}
  }
 }
 return [...orders.values()].filter(o=>!o.deleted).sort((a,b)=>a.createdAt-b.createdAt);
}
class Store{
 constructor(device,events=[]){this.device=device;this.events=[];this.clock=0;this.merge(events);}
 merge(events){let added=0;const ids=new Set(this.events.map(e=>e.id));for(const e of events){if(!validEvent(e)||ids.has(e.id))continue;this.events.push(clone(e));ids.add(e.id);this.clock=Math.max(this.clock,e.clock);added++;}return added;}
 append(e){e={...e,clock:++this.clock,id:this.device+':'+this.clock+':'+Math.random().toString(36).slice(2,9)};if(!validEvent(e))throw Error('Invalid order event');this.events.push(e);return e;}
 orders(){if(this.cachedLength!==this.events.length||this.cachedEvents!==this.events){this.cachedLength=this.events.length;this.cachedEvents=this.events;this.cachedOrders=reduce(this.events);}return this.cachedOrders;}
 ingest(parsed,text,source,station,config,now=Date.now()){
  if(!stations.includes(station))return {kind:'ignored'};
  const identityValue=identity(text,parsed,source,now),kind=control(text);
  const orderKey=identityValue?.key||'unmatched:'+this.device+':'+(this.clock+1);
  const normal=text.replace(/\r/g,'').split('\n').map(clean).filter(Boolean).join('\n');
  const old=this.events.filter(e=>e.kind==='print'&&e.orderKey===orderKey&&e.station===station).sort((a,b)=>a.clock-b.clock||a.id.localeCompare(b.id));
  const semantic=p=>JSON.stringify([p.items.map(i=>[signature(i),i.qty]),p.notes||[],p.metadata?.customer||'']);
  const suspectedVoid=/^\s*(?:VOID(?:ED)?\b|ITEM\s+(?:VOID(?:ED)?|CANCEL(?:LED|ED)?)\b|CANCEL(?:LED|ED)?\b)/mi.test(text);
  if(identityValue&&old.slice(-1).some(e=>(e.payload.rawText.replace(/\r/g,'').split('\n').map(clean).filter(Boolean).join('\n')===normal||!suspectedVoid&&kind==='snapshot'&&e.mode==='snapshot'&&semantic(e.payload)===semantic(parsed))&&now-e.at>=0&&now-e.at<=config.duplicateSeconds*1000))return {kind:'duplicate'};
  let mode=kind==='void'?'void':kind==='addon'||config.updateMode==='delta'?'delta':'snapshot';
  let reason='';
  if(!identityValue&&(kind==='void'||kind==='addon')){mode='review';reason='P18 update has no reliable order number. Verify the original order on P18.';}
  if(kind!=='void'&&suspectedVoid){mode='review';reason='Unrecognized or item-specific void. Verify the affected item on P18.';}
  const existing=this.orders().find(o=>o.key===orderKey);
  if(mode==='delta'&&kind!=='addon'&&!existing?.printedStations?.includes(station))mode='snapshot';
  if(kind==='addon'&&!existing){reason='Add-on arrived without its original order on this station. Verify on P18.';parsed={...parsed,notes:[...(parsed.notes||[]),reason]};}
  const e=this.append({kind:'print',orderKey,station,source,at:now,mode,reason,provider:provider(text),payload:{...clone(parsed),number:identityValue?.number||parsed.number,rawText:text}});
  const after=this.orders().find(o=>o.key===orderKey);
  return {event:e,kind:mode==='void'?'void':mode==='review'?'review':after?.items.some(i=>i.station===station&&i.addedQty>0)?'addon':'new'};
 }
 action(key,station,kind,details={},now=Date.now()){
  const o=this.orders().find(o=>o.key===key);if(!o)throw Error('Order no longer available');
  return this.append({kind,orderKey:key,station,at:now,...details,...(['complete','ack'].includes(kind)?{basis:o.lastPrint?.[station]}:{}),...(kind==='complete'?{revisions:o.items.filter(i=>i.station===station&&!i.removed).map(i=>i.revision)}:{})});
 }
 prune(now=Date.now()){
  const old=new Set(this.orders().filter(o=>now-o.createdAt>=7*86400000&&Object.values(o.states).every(s=>s==='COMPLETE')).map(o=>o.key));
  const gone=new Map(this.events.filter(e=>e.kind==='delete').map(e=>[e.orderKey,e]));
  for(const key of old){const station=this.events.find(e=>e.orderKey===key).station;gone.set(key,this.append({kind:'delete',orderKey:key,station,at:now}));}
  // Tiny deletion markers remain; item details and raw prints are removed. This prevents
  // an offline tablet from resurrecting a deleted ticket when it reconnects later.
  this.events=this.events.filter(e=>!gone.has(e.orderKey)).concat([...gone.values()]);
 }
}
function totals(orders,station){
 const map=new Map();for(const o of orders){if(o.voided)continue;for(const i of o.items){if(i.done||i.removed||o.states[i.station]==='COMPLETE'||station!=='expo'&&i.station!==station)continue;const key=i.station+':'+signature(i);if(!map.has(key))map.set(key,{station:i.station,name:i.name,modifiers:i.modifiers,qty:0});map.get(key).qty+=i.qty;}}
 return [...map.values()].sort((a,b)=>a.name.localeCompare(b.name));
}
root.KrispCore={stations,ports,settings,defaults,Store,reduce,identity,control,provider,totals,signature,validEvent};
})(globalThis);



