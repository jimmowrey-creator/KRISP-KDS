import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../web/krisp-app.js',import.meta.url),'utf8');
const start=source.indexOf('function modifierText('),end=source.indexOf('\n',source.indexOf('function modifier(m)',start));
const ctx={esc:s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')};
vm.createContext(ctx);vm.runInContext(source.slice(start,end),ctx);
test('shows selected modifier without group label',()=>{
 for(const [input,expected] of [['Salsas Disponibles: Honey Mustard','Honey Mustard'],['Dressing: Ranch','Ranch'],['NO: No Pepinos','No Pepinos'],['Honey Mustard','Honey Mustard'],['Sauces:','']])assert.equal(ctx.modifierText(input),expected);
});
test('preserves preparation instructions and allergy warnings',()=>{
 for(const value of ['ALLERGY: sesame','NO: onions','EXTRA: cheese','WITHOUT: salt','SIN: cebolla','Dressing on side'])assert.equal(ctx.modifierText(value),value);
 assert.match(ctx.modifier('Allergies: ALLERGY: sesame'),/important/);
 assert.match(ctx.modifier('NO: No Pepinos'),/important/);
});
test('escapes selected text and hides empty group headings',()=>{
 assert.equal(ctx.modifier('Sauces:'),'');
 assert.match(ctx.modifier('Sauces: <b>Ranch</b>'),/&lt;b&gt;Ranch&lt;\/b&gt;/);
});
