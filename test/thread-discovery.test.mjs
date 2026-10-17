import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {DatabaseSync} from 'node:sqlite';
test('startup discovers more than 30 chats and hydrates offline usage without claiming a live connection',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-discovery-')),home=path.join(dir,'codex'),root=path.join(dir,'control');fs.mkdirSync(home);fs.mkdirSync(root);process.env.CONTEXT_CONTROL_HOME=root;process.env.CONTEXT_CONTROL_CODEX_HOME=home;
 const db=new DatabaseSync(path.join(home,'state_5.sqlite'));
 try{db.exec('CREATE TABLE threads(id TEXT PRIMARY KEY,name TEXT,model TEXT,archived INTEGER,rollout_path TEXT,created_at INTEGER)');
 const file=path.join(home,'rollout.jsonl');fs.writeFileSync(file,JSON.stringify({type:'event_msg',timestamp:new Date().toISOString(),payload:{type:'token_count',info:{last_token_usage:{total_tokens:1200},model_context_window:920000}}})+'\n');
 for(let i=0;i<45;i++)db.prepare('INSERT INTO threads VALUES(?,?,?,?,?,?)').run('chat-'+i,'Chat '+i,'fixture',0,i===0?file:null,100+i);
 const {Store}=await import('../src/store.mjs');const store=new Store();await store.seedRecentMetadata();await store.scanLocal();assert.equal(Object.keys(store.data.threads).length,45);
 const offline=store.publicThread('chat-0');assert.equal(offline.connected,false);assert.equal(offline.phase,'cached');assert.equal(offline.freshUsage,false);assert.equal(offline.lastUsage.totalTokens,1200);assert.equal(offline.model,'fixture');
 store.data.threads['chat-0'].lastUsage={totalTokens:2};store.data.threads['chat-0'].freshUsage=true;
 assert.equal(store.publicThread('chat-0',new Map([['chat-0',[{}]]])).lastUsage.totalTokens,2);
 const bytes=store.threadCache.metrics.bytesRead;await store.scanLocal();assert.equal(store.threadCache.metrics.bytesRead,bytes);store.flush();clearTimeout(store.saveTimer);
 }finally{db.close();fs.rmSync(dir,{recursive:true,force:true});}
});
