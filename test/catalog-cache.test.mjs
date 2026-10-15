import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
test('model catalog is read once and invalidated when replaced or removed',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-catalog-'));process.env.CONTEXT_CONTROL_HOME=root;process.env.CONTEXT_CONTROL_CODEX_HOME=root;
 const file=path.join(root,'models_cache.json');fs.writeFileSync(file,JSON.stringify({models:[{slug:'fixture',max_context_window:500000,effective_context_window_percent:95}]}));
 const {Store}=await import('../src/store.mjs');const store=new Store();store.data.threads.t={id:'t',model:'fixture'};
 const original=fs.readFileSync;let reads=0;fs.readFileSync=function(name,...args){if(String(name)===file)reads++;return original.call(this,name,...args);};
 try{
  for(let n=0;n<100;n++)assert.equal(store.publicThread('t').modelMetadata.max_context_window,500000);assert.equal(reads,1);
  fs.writeFileSync(file+'.new',JSON.stringify({models:[{slug:'fixture',max_context_window:300000}]}));fs.renameSync(file+'.new',file);
  assert.equal(store.model('fixture').max_context_window,300000);assert.equal(reads,2);
  fs.unlinkSync(file);assert.equal(store.model('fixture'),null);
 }finally{fs.readFileSync=original;fs.rmSync(root,{recursive:true,force:true});}
});
