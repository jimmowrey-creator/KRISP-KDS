import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const ctx={window:{}};vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL('./native-print.js',import.meta.url),'utf8'),ctx);
vm.runInContext(fs.readFileSync(process.env.KRISP_CORE||new URL('../web/krisp-core.js',import.meta.url),'utf8'),ctx);
const C=ctx.KrispCore,config=C.settings(),at=1789788000000;
const small='Regular Small Sandwich',large='Large Cold Sandwich';
function send(s,body,station='kitchen',cfg=config){
 const text=`ORDER #42\nPOS number 1\n${body}`;
 ctx.ticketText=text;ctx.station=station;
 const p=vm.runInContext('parseTicket(ticketText,station,NATIVE_CONFIG)',ctx);
 return s.ingest(p,text,'P18',station,cfg,at+s.clock*1000);
}
const row=(s,name)=>s.orders()[0].items.find(i=>i.name===name);
const precheck10='Signapay Demo\n09/18/26                 23:49\nOrderId                    10\nServer              Jim Mowrey\n------------------------\nALFALFA CUBES\n1x                     $10.99\nSENIOR HORSE FEED\n1x                     $25.99\nSUBTOTAL               $36.98\n------------------------\nTAX\nDISCOUNT                $0.00\nTOTAL AMT              $36.98\nTip\nPRECHECK';
const removal10='Order 10\nSent             09/19/26 00:01\nType                 Take-Out\nServer             Jim Mowrey\nPOS number              19114\nRemoved\n- 1 x ALFALFA CUBES\n.';
function receipt(s,text,source='10.0.0.19',time=at){ctx.ticketText=text;const p=vm.runInContext('parseTicket(ticketText,"kitchen",NATIVE_CONFIG)',ctx);return s.ingest(p,text,source,'kitchen',config,time);}
test('photographed Precheck and midnight kitchen removal become one ticket',()=>{
 const s=new C.Store('a');receipt(s,precheck10);receipt(s,removal10,'10.0.0.19',at+12*60000);
 assert.equal(s.orders().length,1);assert.equal(row(s,'ALFALFA CUBES').removed,true);assert.equal(!!row(s,'SENIOR HORSE FEED').removed,false);assert.equal(s.orders()[0].review,false);
 const replay=new C.Store('b',JSON.parse(JSON.stringify(s.events)));assert.equal(JSON.stringify(replay.orders()),JSON.stringify(s.orders()));
 assert.equal(receipt(s,removal10,'10.0.0.19',at+13*60000).kind,'duplicate');
});
test('precheck fallback does not match another source, completed order, old order or ambiguous reused number',()=>{
 for(const variant of ['source','complete','old','ambiguous']){
  const s=new C.Store('a');receipt(s,precheck10);
  if(variant==='complete')s.action(s.orders()[0].key,'kitchen','complete',{},at+1);
  if(variant==='ambiguous')receipt(s,precheck10.replace('09/18/26','09/17/26'),'10.0.0.19',at+1000);
  receipt(s,removal10,variant==='source'?'10.0.0.20':'10.0.0.19',at+(variant==='old'?5*3600000:12*60000));
  assert.equal(!!row(s,'ALFALFA CUBES').removed,false,variant);assert.equal(s.orders().at(-1).review,true,variant);
 }
});
test('later removals keep matching and completion of a former unmatched shell cannot complete the real order',()=>{
 const s=new C.Store('a');receipt(s,precheck10);const removed=receipt(s,removal10,'10.0.0.19',at+12*60000).event;
 s.append({kind:'complete',orderKey:removed.orderKey,station:'kitchen',basis:removed.id,revisions:[],at:at+13*60000});
 assert.equal(s.orders()[0].states.kitchen,'NEW');assert.equal(row(s,'SENIOR HORSE FEED').done,false);
 receipt(s,removal10.replace('ALFALFA CUBES','SENIOR HORSE FEED').replace('00:01','00:02'),'10.0.0.19',at+14*60000);
 assert.equal(s.orders().length,1);assert.equal(row(s,'SENIOR HORSE FEED').removed,true);
});
test('photographed P18 Removed receipt cancels automatically, including saved Build 5 events',()=>{
 const s=new C.Store('a');
 const receive=body=>{
  const text=`Order 8\nSent                 09/18/26 23:32\nType                     Take-Out\nServer                 Jim Mowrey\nPOS number                  19114\n${body}\n.`;
  ctx.ticketText=text;const p=vm.runInContext('parseTicket(ticketText,"kitchen",NATIVE_CONFIG)',ctx);
  return s.ingest(p,text,'10.0.0.19','kitchen',config,at+s.clock*1000);
 };
 receive('1 x REG COLD SANDWICH');receive('1 x LARGE COLD SANDWICH');
 receive('Removed\n- 1.0 x REG COLD SANDWICH');
 assert.equal(row(s,'REG COLD SANDWICH').removed,true);
 assert.equal(!!row(s,'LARGE COLD SANDWICH').removed,false);
 assert.equal(s.orders()[0].review,false);
 assert.equal(s.orders()[0].notes.some(n=>/Removed|REG COLD/.test(n)),false);
 assert.equal(C.totals(s.orders(),'kitchen').length,1);
 const replay=new C.Store('reload',JSON.parse(JSON.stringify(s.events)));
 assert.equal(JSON.stringify(replay.orders()),JSON.stringify(s.orders()));
 assert.equal(receive('Removed\n- 1.0 x REG COLD SANDWICH').kind,'duplicate');
});
test('P18 decimal removal quantity reduces only explicit units',()=>{
 const s=new C.Store('a');send(s,`3 x ${small}`);send(s,`Removed\n- 1.0 x ${small}\n.`);
 assert.equal(row(s,small).qty,2);assert.equal(row(s,small).removed,false);assert.equal(s.orders()[0].review,false);
});
test('P18 Removed supports multiple explicit rows',()=>{
 const s=new C.Store('a');send(s,`2 x ${small}\n1 x ${large}`);send(s,`Removed\n- 1.0 x ${small}\n.\n- 1.0 x ${large}\n.`);
 assert.equal(row(s,small).qty,1);assert.equal(row(s,large).removed,true);assert.equal(s.orders()[0].review,false);
});
test('unmatched or malformed P18 Removed does not cancel unrelated food',()=>{
 for(const text of ['Removed\n- 1.0 x Unknown','Removed\n1.0 x '+small,'Removed\n- 9.0 x '+small]){
  const s=new C.Store('a');send(s,`1 x ${small}`);send(s,text);
  assert.equal(!!row(s,small).removed,false);assert.equal(s.orders()[0].review,true);
 }
});
test('reported P18 regression through unchanged parser: small stays active, large is new',()=>{
 const s=new C.Store('a');send(s,`1 x ${small}`);send(s,`1 x ${large}`);
 assert.equal(s.orders().length,1);assert.equal(s.orders()[0].items.length,2);
 assert.equal(!!row(s,small).removed,false);assert.equal(row(s,small).qty,1);
 assert.equal(row(s,large).addedQty,1);assert.equal(C.totals(s.orders(),'kitchen').length,2);
});
test('full reprint and repeated add-on do not double quantities',()=>{
 const s=new C.Store('a');send(s,`1 x ${small}`);send(s,`1 x ${large}`);
 assert.equal(send(s,`1 x ${large}`).kind,'duplicate');
 send(s,`1 x ${small}\n1 x ${large}`);
 assert.equal(row(s,small).qty,1);assert.equal(row(s,large).qty,1);
});
test('omitted row preserves preparation state, revision and modifiers',()=>{
 const s=new C.Store('a');send(s,`1 x ${small}\n> No onion`);
 const i=row(s,small);s.action(s.orders()[0].key,'kitchen','item',{item:i.id,revision:i.revision,done:true});
 const before=JSON.stringify(row(s,small));send(s,`1 x ${large}`);
 assert.equal(JSON.stringify(row(s,small)),before);
});
test('empty update and lower quantity cannot silently cancel units',()=>{
 const s=new C.Store('a');send(s,`3 x ${small}`);send(s,`1 x ${small}`);send(s,'Sent 10:10 AM');
 assert.equal(row(s,small).qty,3);assert.equal(!!row(s,small).removed,false);
});
test('explicit add-on mode still appends quantities',()=>{
 const s=new C.Store('a');send(s,`1 x ${small}`);send(s,`ADD-ON\n2 x ${small}`);
 assert.equal(row(s,small).qty,3);assert.equal(row(s,small).addedQty,2);
});
for(const marker of ['VOID ITEM','ITEM VOID','CANCEL ITEM','ITEM CANCELLED','VOIDED ITEM']){
 test(`${marker} cancels only the named item`,()=>{
  const s=new C.Store('a');send(s,`1 x ${small}`);send(s,`1 x ${large}`);
  send(s,`${marker}\n1 x ${small}`);
  assert.equal(row(s,small).removed,true);assert.equal(!!row(s,large).removed,false);
  assert.equal(s.orders()[0].voided,false);assert.equal(s.orders()[0].review,false);
  assert.equal(C.totals(s.orders(),'kitchen').length,1);
  assert.equal(send(s,`${marker}\n1 x ${small}`).kind,'duplicate');
  send(s,`2 x ${large}`);assert.equal(row(s,small).removed,true);
 });
}
test('explicit partial void subtracts only the stated quantity',()=>{
 const s=new C.Store('a');send(s,`3 x ${small}`);send(s,`VOID ITEM 1 x ${small}`);
 assert.equal(row(s,small).qty,2);assert.equal(row(s,small).removed,false);assert.equal(row(s,small).changed,true);
});
test('unknown, ambiguous and excessive voids require review without cancelling',()=>{
 for(const body of ['VOID ITEM Unknown','VOID ITEM','VOID ITEM 9 x '+small]){
  const s=new C.Store('a');send(s,`1 x ${small}`);send(s,body);
  assert.equal(!!row(s,small).removed,false);assert.equal(s.orders()[0].review,true);
 }
 const s=new C.Store('a');send(s,`1 x ${small}\n> No onion\n1 x ${small}\n> Extra onion`);send(s,`VOID ITEM ${small}`);
 assert.equal(s.orders()[0].items.filter(i=>i.removed).length,0);assert.equal(s.orders()[0].review,true);
});
test('explicit modifiers identify a single variant',()=>{
 const s=new C.Store('a');send(s,`1 x ${small}\n> No onion\n1 x ${small}\n> Extra onion`);
 send(s,`VOID ITEM\n1 x ${small}\n> No onion`);
 assert.equal(s.orders()[0].items.filter(i=>i.removed).length,1);
 assert.equal(s.orders()[0].items.find(i=>i.removed).modifiers[0],'No onion');
});
test('void words in ordinary modifiers never cancel an item',()=>{
 const s=new C.Store('a');send(s,`1 x ${small}\n> Do not cancel`);send(s,`1 x ${large}\n> Avoid onion`);
 assert.equal(s.orders()[0].items.some(i=>i.removed),false);assert.equal(s.orders()[0].voided,false);
});
test('whole order void remains supported',()=>{
 const s=new C.Store('a');send(s,`1 x ${small}`);send(s,'VOID ORDER #42');assert.equal(s.orders()[0].voided,true);
});
test('other station completion and items are unchanged',()=>{
 const s=new C.Store('a');send(s,'1 x Salad','salad');s.action(s.orders()[0].key,'salad','complete');
 send(s,`1 x ${small}`);send(s,`1 x ${large}`);
 assert.equal(s.orders()[0].states.salad,'COMPLETE');assert.equal(row(s,'Salad').done,true);
});
test('persisted events replay and peer merges converge with the same corrected state',()=>{
 const a=new C.Store('a');send(a,`1 x ${small}`);const b=new C.Store('b',a.events);
 send(a,`1 x ${large}`);b.action(b.orders()[0].key,'kitchen','complete');a.merge(b.events);b.merge(a.events);
 assert.equal(JSON.stringify(a.orders()),JSON.stringify(b.orders()));
 assert.equal(a.orders()[0].states.kitchen,'NEW');assert.equal(!!row(a,small).removed,false);
 const restored=new C.Store('c',JSON.parse(JSON.stringify(a.events)));
 assert.equal(JSON.stringify(restored.orders()),JSON.stringify(a.orders()));
 send(a,`VOID ITEM ${small}`);b.merge(a.events);assert.equal(JSON.stringify(a.orders()),JSON.stringify(b.orders()));
});


