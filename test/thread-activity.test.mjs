import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {EventEmitter} from 'node:events';import {PassThrough} from 'node:stream';
import {activityTime,compareThreadActivity,mergeActivity} from '../src/thread-activity.mjs';import {Bridge} from '../src/bridge.mjs';
test('real activity outranks observation noise; running chats lead and completion is retained',()=>{
 const now=Date.now(),old={id:'old',connected:true,status:'idle',nativeActivityAt:now-90000,observedAt:now},done={id:'done',connected:false,status:'notLoaded',lastCompletedAt:now-1000,observedAt:now-10000},running={id:'running',connected:true,status:'active',lastStartedAt:now-5000};
 assert.deepEqual([old,done,running].sort(compareThreadActivity).map(t=>t.id),['running','done','old']);
 const stopped={...running,status:'idle',...mergeActivity(running,{status:'idle'},{now})};assert.equal(activityTime(stopped),now);
 assert.deepEqual(mergeActivity(stopped,{status:'idle',observedAt:now+999},{now:now+999}),{});
 assert.deepEqual(mergeActivity({status:'active'},{status:'idle'},{now,allowLegacyTransition:false}),{});
 assert.deepEqual(mergeActivity({status:'idle',turnId:'old'},{status:'active',turnId:'old'},{now}),{});
 assert.equal(mergeActivity({status:'idle',turnId:'old'},{status:'active',turnId:'new'},{now}).lastStartedAt,now);
});
test('bridge records canonical start/completion timestamps and reconnect publications do not advance them',()=>{
 const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();const input=new PassThrough(),output=new PassThrough();output.resume();const b=new Bridge(child,input,output,async()=>({}));const r=b.record('chat');
 try{b.fromServer(JSON.stringify({method:'turn/started',params:{threadId:'chat',turn:{id:'turn',startedAt:1792150000}}}));assert.equal(r.lastStartedAt,1792150000000);
 b.fromServer(JSON.stringify({method:'turn/completed',params:{threadId:'chat',turn:{id:'turn',completedAt:1792150010}}}));assert.equal(r.lastCompletedAt,1792150010000);
 b.notify(r);assert.equal(b.publicRecord(r).lastCompletedAt,1792150010000);
 }finally{b.frontLines.close();b.backLines.close();for(const s of [child.stdin,child.stdout,input,output])s.destroy();}
});
test('native recency survives maintenance timestamps and archived/system entries retain classification',async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-recency-')),home=path.join(temp,'home');fs.mkdirSync(home);process.env.CONTEXT_CONTROL_HOME=path.join(temp,'control');process.env.CONTEXT_CONTROL_CODEX_HOME=home;
 const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync(path.join(home,'state_5.sqlite'));const now=Date.now();
 db.exec('CREATE TABLE threads(id TEXT PRIMARY KEY,name TEXT,cwd TEXT,updated_at INTEGER,recency_at_ms INTEGER,created_at_ms INTEGER,thread_source TEXT,archived INTEGER)');
 db.prepare('INSERT INTO threads VALUES(?,?,?,?,?,?,?,?)').run('older','Old chat','/',Math.floor(now/1000),now-100000,now-200000,'user',0);
 db.prepare('INSERT INTO threads VALUES(?,?,?,?,?,?,?,?)').run('recent','Recent completed chat','/',1,now-1000,now-2000,'user',0);
 const history=new DatabaseSync(path.join(home,'thread_history_1.sqlite'));history.exec('CREATE TABLE thread_turns(thread_id TEXT,started_at INTEGER,completed_at INTEGER)');history.prepare('INSERT INTO thread_turns VALUES(?,?,?)').run('recent',Math.floor((now-1000)/1000),Math.floor((now+2000)/1000));history.close();
 const {Store}=await import('../src/store.mjs');const store=new Store();
 try{await store.seedRecentMetadata();assert.equal(store.publicThread('recent').lastActivityAt,Math.floor((now+2000)/1000)*1000);assert.equal(store.publicThread('older').lastActivityAt,now-100000);
 db.prepare('UPDATE threads SET updated_at=? WHERE id=?').run(Math.floor(now/1000)+9999,'older');store.refreshMetadata(true);assert.equal(store.publicThread('older').lastActivityAt,now-100000);
 const rows=Object.keys(store.data.threads).map(id=>store.publicThread(id)).sort(compareThreadActivity);assert.equal(rows[0].id,'recent');
 }finally{store.flush();db.close();fs.rmSync(temp,{recursive:true,force:true});}
});
