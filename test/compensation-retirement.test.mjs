import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createCompensationManager,createCompensationResolver} from '../src/compaction-compensation.mjs';import {prepareContextCatalog} from '../src/context-ceiling.mjs';
test('retired compensation disables inherited preferences, refuses reactivation and retains unknown settings',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-retired-')),file=path.join(home,'compaction-compensation.json');
 try{
  fs.writeFileSync(file,JSON.stringify({enabled:true,future:{preserve:1}}));const manager=createCompensationManager({home});
  assert.equal(manager.enabled(),false);assert.equal(manager.status().available,false);assert.equal(manager.status().pending,false);
  assert.throws(()=>manager.setEnabled(true),/已停用/);assert.deepEqual(JSON.parse(fs.readFileSync(file)).future,{preserve:1});assert.equal(JSON.parse(fs.readFileSync(file)).enabled,false);
  const resolver=createCompensationResolver({home,control:home});assert.equal(resolver.isEnabled(),false);assert.deepEqual(await resolver({id:'unreadable-history'}),{enabled:false});
  const pending=manager.status([{compensationVersion:3}],[{connected:true,policy:{enabled:true},compensation:{enabled:false,targetWindow:920000},observedWindow:1075600}]);assert.equal(pending.pending,true);assert.equal(pending.restoringCount,1);
  fs.copyFileSync(new URL('./fixtures/models.json',import.meta.url),path.join(home,'models_cache.json'));
  fs.writeFileSync(file,JSON.stringify({enabled:true}));const prepared=prepareContextCatalog({home,control:home,enabled:true});assert.equal(prepared.accountingWindowLimit,null);assert.ok(JSON.parse(fs.readFileSync(prepared.file)).models.every(m=>m.max_context_window<16000000));
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
