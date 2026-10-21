import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_SHORTCUT,normalizeShortcut,shortcutFromEvent,createShortcutManager} from '../src/ui-shortcut.mjs';
test('shortcut defaults, normalization and keyboard recording use stable physical letter keys',()=>{
  assert.equal(DEFAULT_SHORTCUT,'Control+Shift+M');assert.equal(normalizeShortcut('shift + ctrl + m'),DEFAULT_SHORTCUT);assert.equal(normalizeShortcut('Win+Alt+K'),'Alt+Super+K');assert.equal(normalizeShortcut('F12'),'F12');
  assert.equal(shortcutFromEvent({key:'μ',code:'KeyM',ctrlKey:true,shiftKey:true}),DEFAULT_SHORTCUT);assert.equal(shortcutFromEvent({key:'Control'}),null);
  for(const value of ['M','Shift+M','Ctrl+Ctrl+M','Ctrl+','Ctrl+A+B','Ctrl+F25'])assert.throws(()=>normalizeShortcut(value));
});
function fixture(options={}){let doc=options.doc||{},triggered=0;const bindings=new Map();const manager=createShortcutManager({read:()=>doc,write:next=>{if(options.failWrite)throw Error('disk error');doc=next;},register:(key,callback)=>{if(key===options.conflict)return false;bindings.set(key,callback);return true;},unregister:key=>bindings.delete(key),onTrigger:()=>triggered++,inactive:options.inactive});return {manager,bindings,doc:()=>doc,triggered:()=>triggered};}
test('default shortcut invokes the window action and custom preferences survive reload',()=>{
  const f=fixture({doc:{version:7,unknown:'keep'}});assert.equal(f.manager.start().registered,true);f.bindings.get(DEFAULT_SHORTCUT)();assert.equal(f.triggered(),1);
  f.manager.set({accelerator:'Ctrl+Alt+K',enabled:true});assert.equal(f.bindings.has(DEFAULT_SHORTCUT),false);assert.equal(f.doc().version,7);assert.equal(f.doc().unknown,'keep');
  f.manager.dispose();assert.equal(f.bindings.size,0);const next=fixture({doc:f.doc()});assert.equal(next.manager.start().accelerator,'Control+Alt+K');
});
test('occupied shortcuts and failed saves leave the previous binding and preferences intact',()=>{
  const f=fixture({conflict:'Control+Alt+K'});f.manager.start();assert.throws(()=>f.manager.set({accelerator:'Ctrl+Alt+K'}),/占用/);assert.equal(f.bindings.has(DEFAULT_SHORTCUT),true);assert.deepEqual(f.doc(),{});
  const failing=fixture({failWrite:true});failing.manager.start();assert.throws(()=>failing.manager.set({accelerator:'Ctrl+Alt+K'}),/disk error/);assert.equal(failing.bindings.has(DEFAULT_SHORTCUT),true);assert.equal(failing.bindings.has('Control+Alt+K'),false);
});
test('disabled and test-only shortcuts do not claim a native binding',()=>{
  const f=fixture();f.manager.start();f.manager.set({accelerator:DEFAULT_SHORTCUT,enabled:false});assert.equal(f.bindings.size,0);assert.equal(f.manager.status().registered,false);
  const preview=fixture({inactive:true});preview.manager.start();preview.manager.set({accelerator:'Ctrl+Alt+P'});assert.equal(preview.bindings.size,0);assert.equal(preview.manager.status().registered,false);
});

test('shared shortcut validation agrees with the native cross-platform contract',async()=>{
 const fs=await import('node:fs');const cases=JSON.parse(fs.readFileSync(new URL('./fixtures/contracts/shortcuts.json',import.meta.url)));
 for(const row of cases.valid)assert.equal(normalizeShortcut(row.input),row.normalized);
 for(const input of cases.invalid)assert.throws(()=>normalizeShortcut(input),undefined,input);
});
test('equivalent aliases preserve one registration and clear stays disabled after restart',()=>{
 const f=fixture({doc:{version:7,keep:'preserved'}});f.manager.start();
 f.manager.set({accelerator:'shift + ctrl + m',enabled:true});assert.equal(f.bindings.size,1);assert.equal(f.manager.status().registered,true);
 f.manager.set({accelerator:'',enabled:true});assert.equal(f.bindings.size,0);assert.equal(f.doc().shortcut.enabled,false);assert.equal(f.doc().keep,'preserved');
 const restarted=fixture({doc:f.doc()});restarted.manager.start();assert.equal(restarted.manager.status().accelerator,'');assert.equal(restarted.manager.status().enabled,false);assert.equal(restarted.bindings.size,0);
});
