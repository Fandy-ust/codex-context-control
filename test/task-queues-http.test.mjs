import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('queue API authenticates, persists complete prompts and config, validates revisions and exposes global management',async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'queue-http-')),home=path.join(temp,'codex'),control=path.join(temp,'control');fs.mkdirSync(home);fs.mkdirSync(control);
 process.env.CONTEXT_CONTROL_HOME=control;process.env.CONTEXT_CONTROL_CODEX_HOME=home;
 fs.writeFileSync(path.join(control,'state.json'),JSON.stringify({version:2,threads:{chat:{id:'chat',name:'队列测试',status:'idle'}},policies:{}}));
 const {startDaemon}=await import('../src/daemon.mjs'),d=await startDaemon();
 try{
  const c=JSON.parse(fs.readFileSync(path.join(control,'connection.json'))),base=`http://127.0.0.1:${c.port}`,headers={authorization:`Bearer ${c.token}`};
  const post=body=>fetch(base+'/task-queue',{method:'POST',headers,body:JSON.stringify(body)});
  assert.equal((await fetch(base+'/task-queue',{method:'POST',body:'{}'})).status,403);
  let response=await post({id:'chat',action:'add',prompt:'完整提示词\n验收：测试通过',expectedRevision:0});assert.equal(response.status,200);let state=await response.json();assert.equal(state.queues[0].enabled,false);assert.equal(state.sleepPrevented,false);
  assert.equal((await post({id:'chat',action:'add',prompt:'过时修改',expectedRevision:0})).status,400);
  assert.equal((await post({id:'__proto__',action:'add',prompt:'bad'})).status,400);
  const saved=JSON.parse(fs.readFileSync(path.join(control,'task-queues.json')));assert.equal(saved.queues.chat.tasks[0].prompt,'完整提示词\n验收：测试通过');
  response=await fetch(base+'/state',{headers});state=await response.json();assert.equal(state.capabilities.taskQueues,true);assert.equal(state.taskQueues.queues.length,1);
  assert.equal((await post({action:'disable-all'})).status,200);
 }finally{d.web.closeAllConnections();await new Promise(r=>d.web.close(r));await new Promise(r=>d.ipcServer.close(r));await new Promise(r=>setTimeout(r,180));fs.rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
