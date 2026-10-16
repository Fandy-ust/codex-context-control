import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
test('service orders by activity rather than replay receipt and preserves completion after disconnect',async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-activity-api-')),home=path.join(temp,'home'),control=path.join(temp,'control');fs.mkdirSync(home);process.env.CONTEXT_CONTROL_HOME=control;process.env.CONTEXT_CONTROL_CODEX_HOME=home;
 const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync(path.join(home,'state_5.sqlite')),now=Date.now();db.exec('CREATE TABLE threads(id TEXT PRIMARY KEY,name TEXT,updated_at_ms INTEGER,recency_at_ms INTEGER,thread_source TEXT,archived INTEGER)');for(const [id,time] of [['old',now-50000],['fresh',now-10000],['active',now-20000]])db.prepare('INSERT INTO threads VALUES(?,?,?,?,?,0)').run(id,id,now,time,'user');db.close();
 const {startDaemon}=await import('../src/daemon.mjs'),{connect,request}=await import('../src/ipc.mjs');const d=await startDaemon();let peer;
 try{
  peer=await connect(async()=>({}));await peer.call('registerBridge',{pid:process.pid});
  await peer.call('updateThread',{id:'active',status:'active',turnId:'current',lastStartedAt:now-20000});
  await peer.call('updateThread',{id:'old',status:'idle'});
  assert.deepEqual((await request('state')).threads.map(t=>t.id),['active','fresh','old']);
  await peer.call('updateThread',{id:'active',status:'idle',turnId:'current',lastStartedAt:now-20000,lastCompletedAt:now});
  peer.close();for(let i=0;i<100&&(await request('state')).bridgeCount;i++)await new Promise(r=>setTimeout(r,5));
  let s=await request('state');assert.equal(s.threads[0].id,'active');assert.equal(s.threads[0].connected,false);assert.equal(s.threads[0].lastActivityAt,now);
  peer=await connect(async()=>({}));await peer.call('registerBridge',{pid:process.pid});await peer.call('updateThread',{id:'old',status:'idle'});s=await request('state');assert.equal(s.threads[0].id,'active');assert.equal(s.threads.find(t=>t.id==='old').lastActivityAt,now-50000);
 }finally{peer?.close();d.web.closeAllConnections();await new Promise(r=>d.web.close(r));await new Promise(r=>d.ipcServer.close(r));d.store.flush();fs.rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
