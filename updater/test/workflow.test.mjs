import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const ctx={};vm.createContext(ctx);vm.runInContext(fs.readFileSync(process.env.KRISP_CORE||new URL('../web/krisp-core.js',import.meta.url),'utf8'),ctx);
const C=ctx.KrispCore,config=C.settings(),time=1789653600000;
const parsed=(qty=1,mods=[])=>({number:'42',type:'Call in',items:[{name:'Burger',qty,modifiers:mods}],notes:[]});
const receive=(store,p=parsed(),s='kitchen',text='ORDER #42\n1 x Burger',at=time,c=config)=>store.ingest(p,text,'10.0.0.25',s,c,at);

test('malformed peer print cannot break the board and Undo cannot erase a print',()=>{
 const s=new C.Store('a');receive(s);const original=s.events[0];
 for(const payload of [{...original.payload,notes:{}},{...original.payload,items:[null]},{...original.payload,metadata:null}])assert.equal(s.merge([{...original,id:'bad',payload}]),0);
 s.action(original.orderKey,'kitchen','undo',{target:original.id});assert.equal(s.orders().length,1);
 s.action(original.orderKey,'kitchen','complete');receive(s,parsed(),'kitchen','ORDER #42\nVOID ITEM Burger',time+1000);assert.equal(s.orders()[0].states.kitchen,'NEW');assert.equal(s.orders()[0].review,false);assert.equal(s.orders()[0].items[0].removed,true);
});

test('KRISP layout bounds and station timer settings',()=>{
 for(let columns=1;columns<=8;columns++)for(let rows=1;rows<=4;rows++){const s=C.settings({columns,rows});assert.equal(s.columns,columns);assert.equal(s.rows,rows);}
 assert.equal(C.settings({columns:9,rows:0}).columns,3);assert.equal(C.settings({station:'dessert'}).station,'dessert');
 assert.equal(C.settings({timers:{salad:{warning:8,late:2}}}).timers.salad.late,10);
});
test('snapshot additions are highlighted, reopen completed station and keep other station progress',()=>{
 const store=new C.Store('a');receive(store);receive(store,{...parsed(),items:[{name:'Salad',qty:1,modifiers:[]}]},'salad','ORDER #42\n1 x Salad');
 const key=store.orders()[0].key;store.action(key,'kitchen','complete',{},time+10);store.action(key,'salad','complete',{},time+10);
 assert.equal(receive(store,parsed(3),'kitchen','ORDER #42\n3 x Burger',time+20).kind,'addon');
 const o=store.orders()[0];assert.equal(o.states.kitchen,'NEW');assert.equal(o.states.salad,'COMPLETE');assert.equal(o.items.find(i=>i.station==='kitchen').addedQty,2);
 store.action(key,'kitchen','ack',{},time+30);assert.equal(store.orders()[0].items[1].addedQty,0);
});
test('identical reprints neither duplicate items nor erase add-on highlighting',()=>{
 const s=new C.Store('a');receive(s);receive(s,parsed(2),'kitchen','ORDER #42\n2 x Burger',time+1000);
 assert.equal(receive(s,parsed(2),'kitchen','ORDER #42\n2 x Burger\nSent 10:10 AM',time+2000).kind,'duplicate');
 assert.equal(s.orders().length,1);assert.equal(s.orders()[0].items[0].qty,2);assert.equal(s.orders()[0].items[0].addedQty,1);
});

test('a lower partial-print quantity is not a cancellation or a duplicate',()=>{
 const s=new C.Store('a');receive(s,parsed(2),'kitchen','ORDER #42\n2 x Burger');receive(s,parsed(3),'kitchen','ORDER #42\n3 x Burger',time+1000);
 assert.notEqual(receive(s,parsed(2),'kitchen','ORDER #42\n2 x Burger',time+2000).kind,'duplicate');assert.equal(s.orders()[0].items[0].qty,3);assert.equal(s.orders()[0].items[0].changed,false);
});

test('a stale completion cannot acknowledge a later void',()=>{
 const a=new C.Store('a');receive(a);const b=new C.Store('b',a.events),key=a.orders()[0].key;
 receive(a,{number:'42',items:[],notes:[]},'kitchen','VOID ORDER #42',time+100);
 b.clock+=5;b.action(key,'kitchen','complete',{},time+200);a.merge(b.events);
 assert.equal(a.orders()[0].voided,true);assert.equal(a.orders()[0].states.kitchen,'NEW');
 a.action(key,'kitchen','complete',{},time+300);assert.equal(a.orders()[0].states.kitchen,'COMPLETE');
});
test('added-items-only mode appends and unknown-order add-ons are flagged',()=>{
 const s=new C.Store('a'),delta=C.settings({updateMode:'delta'});receive(s,parsed(),'kitchen','ORDER #42\n1 x Burger',time,delta);
 assert.equal(s.orders()[0].items[0].addedQty,0);
 receive(s,parsed(2),'kitchen','ORDER #42\nADD-ON\n2 x Burger',time+1000,delta);
 assert.equal(s.orders()[0].items[0].qty,3);
 const other=new C.Store('b');receive(other,parsed(),'kitchen','ORDER #42\nADD-ON\n1 x Burger');assert.match(other.orders()[0].notes.join(' '),/without its original/);
});
test('P18 whole-order void propagates across stations and does not disappear until acknowledged',()=>{
 const s=new C.Store('a');receive(s);receive(s,parsed(),'dessert');
 const p={number:'PRINT',items:[],notes:[]};const result=receive(s,p,'kitchen','VOID ORDER #42',time+10);
 assert.equal(result.kind,'void');assert.equal(s.orders().length,1);assert.equal(s.orders()[0].voided,true);assert.equal(s.orders()[0].states.dessert,'NEW');
});
test('item void and missing-order update never void an unrelated order',()=>{
 const s=new C.Store('a');receive(s);
 receive(s,parsed(),'kitchen','ORDER #42\nVOID ITEM\n1 x Burger',time+10);
 assert.equal(s.orders()[0].voided,false);assert.equal(s.orders()[0].review,false);assert.equal(s.orders()[0].items[0].removed,true);
 receive(s,{number:'PRINT',items:[],notes:[]},'kitchen','ORDER VOIDED',time+20);
 assert.equal(s.orders()[0].voided,false);assert.equal(s.orders().length,2);
});
test('terminals and business dates distinguish reused order numbers',()=>{
 const s=new C.Store('a');receive(s,parsed(),'kitchen','09/17/26\nORDER #42');receive(s,parsed(),'kitchen','09/18/26\nORDER #42');
 s.ingest(parsed(),'09/17/26\nORDER #42','10.0.0.26','kitchen',config,time);assert.equal(s.orders().length,3);
});
test('paired replicas converge and a stale completion cannot hide an add-on',()=>{
 const a=new C.Store('a');receive(a);const b=new C.Store('b',a.events),key=a.orders()[0].key;
 receive(a,parsed(2),'kitchen','ORDER #42\n2 x Burger',time+10);b.action(key,'kitchen','complete',{},time+20);
 a.merge(b.events);b.merge(a.events);assert.equal(JSON.stringify(a.orders()),JSON.stringify(b.orders()));assert.equal(a.orders()[0].states.kitchen,'NEW');
 assert.equal(a.merge(b.events),0);
});
test('Undo reverses only its completion; a later order change remains',()=>{
 const s=new C.Store('a');receive(s);const key=s.orders()[0].key,e=s.action(key,'kitchen','complete',{},time+1);
 receive(s,parsed(2),'kitchen','ORDER #42\n2 x Burger',time+2);s.action(key,'kitchen','undo',{target:e.id},time+3);
 assert.equal(s.orders()[0].items[0].qty,2);assert.equal(s.orders()[0].states.kitchen,'NEW');
});
test('totals exclude completed, removed and voided items and preserve modifier variants',()=>{
 const s=new C.Store('a');receive(s,parsed(2,['NO ONION']));
 receive(s,{number:'43',items:[{name:'Burger',qty:1,modifiers:[]}],notes:[]},'kitchen','ORDER #43\n1 x Burger');
 assert.equal(C.totals(s.orders(),'kitchen').length,2);
 const key=s.orders()[0].key;s.action(key,'kitchen','complete');assert.equal(C.totals(s.orders(),'kitchen').length,1);
});
test('retention removes old completed print data, keeps active tickets and prevents stale resurrection',()=>{
 const s=new C.Store('a');receive(s);const old=JSON.parse(JSON.stringify(s.events));s.action(s.orders()[0].key,'kitchen','complete',{},time+100);
 s.prune(time+8*86400000);assert.equal(s.orders().length,0);assert.equal(s.events.length,1);assert.equal(s.events[0].kind,'delete');assert.equal(s.events[0].payload,undefined);
 s.merge(old);assert.equal(s.orders().length,0);
 const active=new C.Store('b',old);active.prune(time+8*86400000);assert.equal(active.orders().length,1);
});
test('demo and real stores never mix and malformed peer actions are rejected',()=>{
 const real=new C.Store('real'),demo=new C.Store('demo');receive(demo);assert.equal(real.events.length,0);
 const e={id:'bad',orderKey:'x',station:'salad',clock:1,at:time,kind:'complete',revisions:{}};assert.equal(real.merge([e]),0);
});


