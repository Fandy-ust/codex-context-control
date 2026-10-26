import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('queue API authenticates, persists complete prompts and config, validates revisions and exposes global management',async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'queue-http-')),home=path.join(temp,'codex'),control=path.join(temp,'control');fs.mkdirSync(home);fs.mkdirSync(control);fs.copyFileSync(new URL('fixtures/models.json',import.meta.url),path.join(home,'models_cache.json'));
 process.env.CONTEXT_CONTROL_HOME=control;process.env.CONTEXT_CONTROL_CODEX_HOME=home;
 // This HTTP test exercises routing and persistence, never a live account runtime.
 process.env.CONTEXT_CONTROL_REAL_CODEX=process.execPath;
 fs.writeFileSync(path.join(control,'state.json'),JSON.stringify({version:2,threads:{chat:{id:'chat',name:'队列测试',status:'idle'}},policies:{}}));
 const {startDaemon}=await import('../src/daemon.mjs'),d=await startDaemon();let bridge;
 const {connect}=await import('../src/ipc.mjs');
 try{
  const c=JSON.parse(fs.readFileSync(path.join(control,'connection.json'))),base=`http://127.0.0.1:${c.port}`,headers={authorization:`Bearer ${c.token}`};
  const post=body=>fetch(base+'/task-queue',{method:'POST',headers,body:JSON.stringify(body)});
  assert.equal((await fetch(base+'/task-queue',{method:'POST',body:'{}'})).status,403);
  for(const enabled of [true,false]){const response=await post({action:'account-switch',enabled});assert.equal(response.status,200);assert.equal((await response.json()).accountSwitch.enabled,enabled);}
  let response=await post({id:'chat',action:'add',prompt:'完整提示词\n验收：测试通过',expectedRevision:0});assert.equal(response.status,200);let state=await response.json();assert.equal(state.queues[0].enabled,false);assert.equal(state.sleepPrevented,false);
  assert.equal((await post({id:'chat',action:'add',prompt:'过时修改',expectedRevision:0})).status,400);
  assert.equal((await post({id:'__proto__',action:'add',prompt:'bad'})).status,400);
  const saved=JSON.parse(fs.readFileSync(path.join(control,'task-queues.json')));assert.equal(saved.queues.chat.tasks[0].prompt,'完整提示词\n验收：测试通过');
  response=await fetch(base+'/state',{headers});state=await response.json();assert.equal(state.capabilities.taskQueues,true);assert.ok(state.queueModels.some(m=>m.id==='context-fixture'&&m.efforts.includes('high')));assert.equal(state.taskQueues.queues.length,1);
  assert.equal((await post({action:'disable-all'})).status,200);
  const calls=[];bridge=await connect(async(op,params)=>{calls.push({op,params});if(op==='queue-prepare'){await bridge.call('updateThread',{id:params.id,status:'idle',model:'fixture'});return {ok:true};}throw Error('Unexpected queue dispatch');});
  await bridge.call('registerBridge',{version:'0.19.20'});await bridge.call('updateThread',{id:'chat',status:'idle'});
  response=await post({id:'chat',action:'enable',enabled:true});assert.equal(response.status,400);assert.match((await response.json()).error,/重新打开 Codex/);assert.equal(calls.length,0);
  // A compatible sole runtime can restore a different unopened chat without a UI click.
  d.store.data.threads.unopened={id:'unopened',status:'idle'};
  await bridge.call('registerBridge',{version:'0.22.4',taskQueueVersion:4});
  assert.equal((await post({id:'missing',action:'enable',enabled:true})).status,400);assert.equal(calls.length,0);
  response=await post({id:'unopened',action:'enable',enabled:true});assert.equal(response.status,200);assert.equal(calls[0].op,'queue-prepare');assert.equal(calls[0].params.id,'unopened');
  // Empty queues remain monitored for later manual turns.
  assert.equal((await response.json()).queues.find(q=>q.id==='unopened').enabled,true);
  response=await post({action:'monitoring',enabled:false});assert.equal(response.status,200);state=await response.json();assert.equal(state.monitoringEnabled,false);assert.equal(state.queues.find(q=>q.id==='unopened').enabled,true);assert.equal(state.sleepPrevented,false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(control,'task-queues.json'))).monitoringEnabled,false);
  await post({action:'disable-all'});

 }finally{bridge?.socket.destroy();d.web.closeAllConnections();await new Promise(r=>d.web.close(r));await new Promise(r=>d.ipcServer.close(r));await new Promise(r=>setTimeout(r,180));fs.rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
