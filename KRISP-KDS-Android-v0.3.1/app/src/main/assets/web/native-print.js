window.jimsNative=true;
const Buffer={from:v=>new Uint8Array(v),concat:parts=>{const result=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const part of parts){result.set(part,at);at+=part.length}return result}};
const NATIVE_CONFIG={barKeywords:["beer","wine","margarita","cocktail","coke","iced tea","lemonade"]};
// Conservative text extraction, not a full Epson firmware emulator.
function decode(bytes) {
 let text='', warnings=[], cuts=[], completions=[];
 for(let i=0;i<bytes.length;) {
  const b=bytes[i];
  if(b===0x10 && bytes[i+1]===4){i+=3;continue;}
  if(b===0x1b){const c=bytes[i+1];
   // ESC = selects the peripheral; it is not ticket content.
   if(c===0x3d){if(i+3>bytes.length)break;i+=3;continue;}
   if(c===0x40){i+=2;continue;}
   if([0x21,0x45,0x47,0x61,0x64,0x4a,0x33,0x74,0x4d,0x2d,0x20,0x7b,0x56,0x72].includes(c)){i+=3;continue;}
   if(c===0x32){i+=2;continue;}
   if(c===0x70){i+=5;continue;}
   if(c===0x24||c===0x5c){i+=4;continue;}
   if(c===0x2a && bytes.length>=i+5){const n=bytes[i+3]+256*bytes[i+4];i+=5+n*([32,33].includes(bytes[i+2])?3:1);warnings.push('Graphics skipped; inspect original ticket');continue;}
   warnings.push('Unknown ESC command; verify ticket');i+=2;continue;
  }
  if(b===0x1d){const c=bytes[i+1];
   if(c===0x56){const size=[65,66,97,98].includes(bytes[i+2])?4:3;if(i+size>bytes.length)break;cuts.push(i+size);text+='\n';i+=size;continue;}
   if(c===0x76&&bytes[i+2]===0x30&&bytes.length>=i+8){const n=(bytes[i+4]+256*bytes[i+5])*(bytes[i+6]+256*bytes[i+7]);i+=8+n;warnings.push('Raster image skipped: readable kitchen text required');continue;}
   if(c===0x28&&bytes.length>=i+5){const size=5+bytes[i+3]+256*bytes[i+4];if(i+size>bytes.length)break;
    if(bytes[i+2]===0x48&&size===11&&bytes[i+5]===0x30&&bytes[i+6]===0x30){completions.push({end:i+size,reply:Buffer.concat([Buffer.from([0x37,0x22]),bytes.subarray(i+7,i+11),Buffer.from([0])])});}
    else warnings.push('Extended command skipped');i+=size;continue;}
   if([0x21,0x42,0x61,0x72,0x68,0x77,0x48,0x66,0x62].includes(c)){i+=3;continue;}
   if(c===0x4c||c===0x57||c===0x50){i+=4;continue;}
   warnings.push('Unknown GS command; verify ticket');i+=2;continue;
  }
  if(b===10||b===13)text+='\n';else if(b===9)text+='  ';else if(b>=32&&b<127)text+=String.fromCharCode(b);else if(b>=128){text+='?';warnings.push('Non-ASCII text requires code-page mapping');}
  i++;
 }
 return {text:text.replace(/\n{3,}/g,'\n\n').trim(),warnings:[...new Set(warnings)],cuts,completions};
}
function parseTicket(text, station, config) {
 if(/^PRECHECK\s*$/mi.test(text))return parsePrecheck(text,station,config);
 const lines=text.split('\n'),items=[];let notes=[], number='PRINT',type='Kitchen ticket',metadata={};let wrapping=false;
 for(let lineIndex=0;lineIndex<lines.length;lineIndex++){const original=lines[lineIndex],s=original.trim();if(!s)continue;
  const customer=!items.length&&s.match(/^(?:Consumer|Customer)(?:\s*:\s*|\s+|$)(.*)$/i);
  if(customer){let name=customer[1].trim();
   if(!name&&/^\s{2,}\S/.test(lines[lineIndex+1]||'')&&!/^\s*\d+\s*x?\s/i.test(lines[lineIndex+1]))name=lines[++lineIndex].trim();
   if(name){metadata.customer=name;wrapping=false;continue;}
  }
  const header=s.match(/^(Sent|Type|Server|POS number)\s+(.+)$/i);if(header){metadata[header[1].toLowerCase()]=header[2];if(header[1].toLowerCase()==='type')type=header[2];wrapping=false;continue;}
  if(s==='.') {wrapping=false;continue;}
  const order=s.match(/^(?:ORDER|TICKET|CHECK)\s*(?:NO\.?|#|:)?\s*([\w-]+)/i);if(order){number=order[1];continue;}
  if(/^(?:DINE IN|TAKE OUT|TO GO|DELIVERY|TABLE\b)/i.test(s)){type=s;continue;}
  if(/^[\s=_*-]+$/.test(s)||/^(?:KITCHEN|BAR|P18|DEJAPAY)\s*$/i.test(s))continue;
  const m=s.match(/^(?:\+\s*)?(\d{1,3})\s*(?:x\s+|\s+)(.+)$/i);
  if(m){wrapping=false;const name=m[2];items.push({id:items.length+'',qty:+m[1],name,modifiers:[],station:station==='bar'||config.barKeywords.some(k=>name.toLowerCase().includes(k))?'bar':'kitchen'});}
  else if(items.length&&s.startsWith('>')){items.at(-1).modifiers.push(s.replace(/^>\s*/,''));wrapping=true;}
  else if(items.length&&wrapping){const mods=items.at(-1).modifiers;mods[mods.length-1]+=' '+s;}
  else if(items.length&&(/^(?:[-+•]|NO\b|EXTRA\b|ADD\b|WITHOUT\b|ALLERGY\b)/i.test(s)||/^\s{2,}/.test(original)))items.at(-1).modifiers.push(s.replace(/^[-+•]\s*/,''));
  else notes.push(s);
 }
 const needsReview=!items.length||notes.length>0;
 if(metadata.customer)notes.unshift('Customer: '+metadata.customer);
 return {number,type,metadata,items,notes,rawText:text,needsReview};
}

// Keep receipt classification conservative: require copy marker and sales totals.
function isSalesReceipt(text=''){return /^(?:CUSTOMER|MERCHANT) COPY\s*$/mi.test(text)&&/^TOTAL AMT\s+\$?[\d,.]+\s*$/mi.test(text)&&/^ReferenceId\s+\S+/mi.test(text);}
function modifierLabel(text){return text.replace(/^(?:B|F|EM|HC|C|S):\s*/,'');}
function modifierLines(text){
 // Chico Locker prints its fixings group as a comma-separated list.
 // Preserve other notes verbatim, especially allergy/preparation instructions.
 return /^F:\s*/.test(text)?modifierLabel(text).split(/,\s*/).map(s=>s.trim()).filter(Boolean):[modifierLabel(text)];
}

// Suppress near-term reprints only when the complete normalized kitchen text matches.
function uniqueKitchenOrders(orders){
 const seen=new Map();return orders.filter(o=>{
  if(o.demo||!o.metadata?.sent||!o.metadata?.['pos number']||!o.items?.length)return true;
  const key=JSON.stringify([o.source,o.station,o.number,o.metadata.sent,o.metadata['pos number'],(o.rawText||'').replace(/\s+/g,' ').trim()]);
  const prior=seen.get(key);if(prior!==undefined&&o.createdAt>=prior&&o.createdAt-prior<=120000)return false;
  seen.set(key,o.createdAt);return true;
 });
}


function parsePrecheck(text,station,config){
 const lines=text.split('\n').map(s=>s.trim()).filter(Boolean),items=[],notes=[],metadata={};
 const number=lines.find(s=>/^OrderId\s+/i.test(s))?.replace(/^OrderId\s+/i,'')||'PRINT';
 let body=false,finished=false,pending=[];
 for(const s of lines){
  if(/^-{3,}$/.test(s)){body=true;continue;}
  if(!body){const customer=s.match(/^(?:Consumer|Customer)\s+(.+)$/i);if(customer)metadata.customer=customer[1];continue;}
  if(/^(?:SUBTOTAL|TOTAL AMT|TAX|DISCOUNT|PRECHECK)\b/i.test(s)){if(pending.length){notes.push(pending.join(' '));pending=[];}finished=true;continue;}
  if(finished)continue;
  const quantity=s.match(/^(\d+(?:\.\d+)?)\s*x\s+\$[\d,.]+$/i);
  if(quantity){if(!pending.length){notes.push('Item name missing');continue;}const name=pending.join(' ');pending=[];items.push({id:String(items.length),qty:Number(quantity[1]),name,modifiers:[],station:station==='bar'||config.barKeywords.some(k=>name.toLowerCase().includes(k))?'bar':'kitchen'});continue;}
  const priced=s.match(/^(.*?)\s+\$[\d,.]+$/);
  if(priced){const label=[...pending,priced[1]].join(' ').trim();pending=[];if(items.length)items.at(-1).modifiers.push(label);else notes.push(label);continue;}
  pending.push(s);
 }
 if(pending.length)notes.push(pending.join(' '));
 const needsReview=!items.length||notes.length>0;
 if(metadata.customer)notes.unshift('Customer: '+metadata.customer);
 return {number,type:'Precheck',metadata,items,notes,rawText:text,needsReview};
}

window.receiveNativePrint=function(base64,source,stationName="kitchen"){
 const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
 let text;
 if(new TextDecoder().decode(bytes.subarray(0,5))==="POST "){
  const request=new TextDecoder().decode(bytes),body=request.slice(request.indexOf("\r\n\r\n")+4),payload=JSON.parse(body);
  text=String(payload.receipt||"").replace(/<BR\s*\/?>/gi,"\n").replace(/<[^>]*>/g,"").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&").trim();
 }else text=decode(bytes).text;
 if(!text.trim()||isSalesReceipt(text))return;
 const parsed=parseTicket(text,stationName,NATIVE_CONFIG);
 parsed.id=globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random()}`;
 parsed.createdAt=Date.now();parsed.station=stationName;parsed.source=source;
 parsed.states={[stationName]:"NEW"};parsed.done=[];
 parsed.items=parsed.items.map(item=>({...item,station:stationName,modifiers:item.modifiers.flatMap(modifierLines)}));
 orders.push(parsed);persist();render();
 return true;
};
