import test from 'node:test';
import assert from 'node:assert/strict';
import {trayState} from '../src/tray-state.mjs';
test('tray uses both active status forms, fresh readback only, and cached recent chats',()=>{
  const base={connected:true,lastActivityAt:100,observedWindow:400000,lastUsage:{totalTokens:100000},freshUsage:true};
  const chats=[{...base,id:'running',status:'inProgress'},{...base,id:'stale',status:'active',freshUsage:false,lastUsage:{totalTokens:399000}},{...base,id:'cached',connected:false,status:'active'},{...base,id:'idle',status:'idle'},{...base,id:'managed',threadSource:'subagent',status:'active'},{id:'never',connected:false,status:'idle'}];
  const state=trayState(chats);assert.deepEqual(state.running.map(t=>t.id),['running','stale']);assert.equal(state.fraction,.25);assert.deepEqual(state.recent.map(t=>t.id),['cached','idle']);
  const offline=trayState(chats,false);assert.equal(offline.running.length,0);assert.equal(offline.fraction,null);assert.ok(offline.recent.some(t=>t.id==='running'));
});

test('compensation does not dilute the real context percentage in the tray',()=>{
 const chat={id:'chat',status:'active',connected:true,freshUsage:true,lastUsage:{totalTokens:800000},observedWindow:1420000,compensation:{enabled:true,status:'active',runtimeWindow:1420000,targetWindow:920000}};
 assert.equal(trayState([chat]).fraction,800000/920000);
});
