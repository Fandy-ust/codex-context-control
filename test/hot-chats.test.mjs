import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {hotChatIds} from '../src/core/hot-chats.mjs';
test('automatic ledger discovery reads twenty sources; explicit history refresh and active exceptions are separate',async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'cm-hot-ledger-')),home=path.join(temp,'codex');fs.mkdirSync(home);
 const {DatabaseSync}=await import('node:sqlite'),db=new DatabaseSync(path.join(home,'state_5.sqlite'));db.exec('CREATE TABLE threads(id TEXT PRIMARY KEY,rollout_path TEXT,recency_at_ms INTEGER,thread_source TEXT,archived INTEGER)');
 for(let n=0;n<100;n++){const file=path.join(home,n+'.jsonl');fs.writeFileSync(file,'');db.prepare('INSERT INTO threads VALUES(?,?,?,?,0)').run('chat-'+n,file,Date.now()-n*1000,'user');}db.close();
 const {QuotaLedger}=await import('../src/analytics/ledger.mjs'),ledger=new QuotaLedger({file:path.join(temp,'ledger.sqlite'),home});
 try{assert.equal(ledger.scan().files,20);assert.equal(ledger.scan({includeIds:['chat-99']}).files,21);assert.equal(ledger.scan({all:true}).files,100);}finally{ledger.close();fs.rmSync(temp,{recursive:true,force:true});}
});
test('hot selection caps ordinary chats before hydration and retains explicit critical exceptions',()=>{
 const rows=Array.from({length:100},(_,i)=>({id:String(i),time:i,threadSource:'user'}));
 const options={compare:(a,b)=>b.time-a.time};assert.deepEqual(hotChatIds(rows,options),rows.slice(-20).reverse().map(t=>t.id));
 const result=hotChatIds(rows,{...options,requiredIds:['1','2','1','missing']});assert.equal(result.length,22);assert.ok(result.includes('1'));assert.ok(result.includes('2'));
 assert.equal(hotChatIds(rows.map(t=>({...t,archived:true})),options).length,0);
});
test('service reads only recent metadata, pins active/selected chats and lazily loads cold IDs without changing recency',async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'cm-hot-')),home=path.join(temp,'codex'),control=path.join(temp,'control');fs.mkdirSync(home);fs.mkdirSync(control);process.env.CONTEXT_CONTROL_HOME=control;process.env.CONTEXT_CONTROL_CODEX_HOME=home;
 const {DatabaseSync}=await import('node:sqlite'),db=new DatabaseSync(path.join(home,'state_5.sqlite'));db.exec('CREATE TABLE threads(id TEXT PRIMARY KEY,name TEXT,model TEXT,cwd TEXT,recency_at_ms INTEGER,thread_source TEXT,archived INTEGER)');const now=Date.now();
 for(let n=0;n<100;n++)db.prepare('INSERT INTO threads VALUES(?,?,?,?,?,?,0)').run('chat-'+String(n).padStart(3,'0'),'Chat '+n,'fixture','/project',now-n*1000,'user');db.close();
 const {startDaemon}=await import('../src/daemon.mjs'),{request,connect}=await import('../src/ipc.mjs'),d=await startDaemon();let peer;
 try{
  assert.equal(d.store.scanRows.length,20);assert.equal(Object.keys(d.store.data.threads).length,20);
  let reads=0;const read=d.store.publicThread.bind(d.store);d.store.publicThread=(...args)=>{reads++;return read(...args);};
  let state=await request('state');assert.equal(state.threads.length,20);assert.equal(reads,20,'cold chats must not be hydrated and then filtered');
  peer=await connect(async()=>({}));await peer.call('registerBridge',{pid:process.pid});await peer.call('updateThread',{id:'chat-090',model:'fixture',status:'active',turnId:'long-running',lastStartedAt:now-1000000});
  state=await request('state');assert.equal(state.threads.length,21);assert.ok(state.threads.some(t=>t.id==='chat-090'));
  state=await request('state',{selectedIds:['chat-080']});assert.equal(state.threads.length,22);assert.ok(state.threads.some(t=>t.id==='chat-080'));assert.ok(d.store.scanRows.length<=22);
  const connection=JSON.parse(fs.readFileSync(path.join(control,'connection.json'))),headers={Authorization:`Bearer ${connection.token}`};
  const post=async(route,body)=>{const r=await fetch(`http://127.0.0.1:${connection.port}${route}`,{method:'POST',headers,body:JSON.stringify(body)});assert.equal(r.status,200);return r.json();};
  const page=await post('/chats/list',{offset:20});assert.equal(page.chats.length,20);assert.equal(page.chats[0].id,'chat-020');assert.equal(page.hasMore,true);assert.equal(d.store.data.threads['chat-020'],undefined,'index paging must not hydrate cold chats');
  const cold=await post('/chat',{id:'chat-070',summary:false});assert.equal(cold.name,'Chat 70');assert.equal(cold.lastActivityAt,now-70000);assert.ok(!('lastStartedAt' in cold));
  const hot=await post('/state/hot',{selectedIds:['chat-070']});assert.ok(hot.threads.some(t=>t.id==='chat-070'));assert.equal(hot.hotChats.limit,20);
  await post('/task-queue',{id:'chat-060',action:'add',prompt:'Waiting work remains visible without enabling the queue.'});
  const queued=await request('state');assert.ok(queued.threads.some(t=>t.id==='chat-060'));assert.equal(queued.taskQueues.queues.find(q=>q.id==='chat-060').enabled,false);
 }finally{peer?.close();d.web.closeAllConnections();await new Promise(r=>d.web.close(r));await new Promise(r=>d.ipcServer.close(r));await d.store.threadCache.running;d.store.flush();fs.rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
