import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

test('statistics endpoint requires authentication and a known chat, returns no raw text',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'stats-http-')),home=path.join(root,'codex');fs.mkdirSync(home);
 process.env.CONTEXT_CONTROL_HOME=path.join(root,'control');process.env.CONTEXT_CONTROL_CODEX_HOME=home;
 const id='33333333-3333-3333-3333-333333333333',file=path.join(home,'history.jsonl');
 fs.writeFileSync(file,[{type:'session_meta',payload:{}},{type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'PRIVATE_BODY_NOT_FOR_API'}]}}].map(x=>JSON.stringify(x)).join('\n')+'\n');
 const db=new DatabaseSync(path.join(home,'state_5.sqlite'));db.exec('CREATE TABLE threads(id TEXT,rollout_path TEXT)');db.prepare('INSERT INTO threads VALUES(?,?)').run(id,file);db.close();
 const {startDaemon}=await import('../src/daemon.mjs');const daemon=await startDaemon();daemon.store.data.threads[id]={id};
 assert.equal(fs.existsSync(path.join(root,'control/quota-history.sqlite')),false,'starting without saved accounts keeps the quota ledger lazy');
 try{
  const connection=JSON.parse(fs.readFileSync(path.join(root,'control/connection.json'),'utf8'));
  const url=`http://127.0.0.1:${connection.port}/context-stats`;
  const post=(body,headers={})=>fetch(url,{method:'POST',body:JSON.stringify(body),headers});
  assert.equal((await post({id})).status,403);
  const headers={authorization:`Bearer ${connection.token}`};
  assert.equal((await post({id},{...headers,origin:'http://localhost'})).status,403);
  assert.equal((await post({id:'unknown'},headers)).status,400);
  const result=await post({id},headers);assert.equal(result.status,200);const text=await result.text();assert.ok(!text.includes('PRIVATE_BODY'));const out=JSON.parse(text);assert.equal(out.threadId,id);assert.equal(out.unclassified.tokensEstimate,null);
 }finally{daemon.web.closeAllConnections();await new Promise(r=>daemon.web.close(r));await new Promise(r=>daemon.ipcServer.close(r));fs.rmSync(root,{recursive:true,force:true});}
});
