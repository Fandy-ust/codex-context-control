import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('preload forwards compensation toggles and rejects unknown actions before IPC',async()=>{
 let exposed;
 const calls=[];
 const electron={
  contextBridge:{exposeInMainWorld(name,value){assert.equal(name,'contextManager');exposed=value;}},
  ipcRenderer:{async invoke(...args){calls.push(args);return {enabled:args[2].enabled};}},
  webUtils:{}
 };
 vm.runInNewContext(fs.readFileSync(new URL('../desktop/preload.cjs',import.meta.url),'utf8'),{require(name){assert.equal(name,'electron');return electron;}});
 for(const enabled of [true,false]){
  assert.deepEqual(await exposed.invoke('compensation',{enabled}),{enabled});
  assert.deepEqual(calls.at(-1),['context-manager','compensation',{enabled}]);
 }
 await exposed.invoke('cloud-copy-credential',{field:'key'});
 assert.deepEqual(calls.at(-1),['context-manager','cloud-copy-credential',{field:'key'}]);
 await assert.rejects(exposed.invoke('unknown-action'),/Unknown action/);
 assert.equal(calls.length,3);
});
