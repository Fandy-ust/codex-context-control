import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('agent HTTP supports targeted snapshots, pure plans, scoped receipts, deferred execution and structured conflicts',async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'cm-agent-')),control=path.join(temp,'control'),home=path.join(temp,'codex');fs.mkdirSync(control);fs.mkdirSync(home);
 fs.copyFileSync(new URL('fixtures/models.json',import.meta.url),path.join(home,'models_cache.json'));
 fs.writeFileSync(path.join(control,'state.json'),JSON.stringify({version:2,policies:{chat:{window:421053,compact:350000,reserve:16000,retainedFloor:0,scope:'total',revision:1,enabled:true}},threads:{chat:{id:'chat',model:'context-fixture',status:'idle'},other:{id:'other',model:'context-fixture'}}}));
 process.env.CONTEXT_CONTROL_HOME=control;process.env.CONTEXT_CONTROL_CODEX_HOME=home;
 const {startDaemon}=await import('../src/daemon.mjs'),{connect}=await import('../src/ipc.mjs');const daemon=await startDaemon();let peer;const compactCalls=[];
 try{
  const connection=JSON.parse(fs.readFileSync(path.join(control,'connection.json'))),base=`http://127.0.0.1:${connection.port}`,headers={authorization:`Bearer ${connection.token}`};
  const post=async(route,body)=>{const response=await fetch(base+route,{method:'POST',headers,body:JSON.stringify(body)});return {status:response.status,data:await response.json()};};
  peer=await connect(async(op,p)=>{if(op==='context-compact'){compactCalls.push(p);return {started:true};}if(op==='setPolicy')return {queued:true};throw Error(op);});
  await peer.call('registerBridge',{pid:process.pid,contextOperationsVersion:1});
  const update=(change={})=>peer.call('updateThread',{id:'chat',model:'context-fixture',turnId:'turn',status:'active',usageFresh:true,lastUsage:{totalTokens:100000},revision:1,expectedWindow:400000,...change});await update();
  const snap=await post('/chat',{id:'chat',summary:true});assert.equal(snap.status,200);assert.equal(snap.data.id,'chat');assert.equal(snap.data.capabilities.compactWhenIdle,true);assert.equal(snap.data.threads,undefined);
  const plan=await post('/preflight',{id:'chat',budget:{usableWindow:500000,compact:450000,reserve:16000}});assert.equal(plan.data.registered,false);assert.equal(plan.data.budgetValid,true);assert.equal(plan.data.execution.when,'idle');assert.equal((await post('/context-operation',{id:'chat',action:'list'})).data.operations.length,0);
  const compactRequest={id:'chat',track:true,whenIdle:true,requestId:'compact-user-confirmed'};
  const receipt=(await post('/compact',compactRequest)).data.operation;assert.equal(receipt.state,'waiting_for_idle');assert.equal(compactCalls.length,0);
  assert.equal((await post('/compact',compactRequest)).data.operation.id,receipt.id);
  const forbidden=await post('/context-operation',{id:'other',action:'show',operationId:receipt.id});assert.equal(forbidden.data.code,'OPERATION_NOT_FOUND');
  await update({status:'idle'});await new Promise(r=>setTimeout(r,10));assert.equal(compactCalls.length,0,'idle status alone is not the exact turn completion');
  await update({status:'idle',lastTurnStatus:'completed',lastCompletedTurnId:'turn'});for(let n=0;n<100&&!compactCalls.length;n++)await new Promise(r=>setTimeout(r,5));assert.equal(compactCalls.length,1);
  assert.equal(compactCalls[0].turnId,'turn');assert.equal(compactCalls[0].operationId,receipt.id);
  await peer.call('updateContextOperation',{id:'chat',operationId:receipt.id,state:'completed'});
  assert.equal((await post('/context-operation',{id:'chat',action:'show',operationId:receipt.id})).data.operation.state,'completed');
  await post('/compact',compactRequest);assert.equal(compactCalls.length,1);
  await update();const cancelled=(await post('/compact',{...compactRequest,requestId:'cancel-me'})).data.operation;
  assert.equal((await post('/context-operation',{id:'chat',action:'cancel',operationId:cancelled.id})).data.operation.state,'cancelled');await update({status:'idle'});assert.equal(compactCalls.length,1);
  const budget={id:'chat',track:true,requestId:'budget-once',expectedRevision:1,budget:{usableWindow:500000,compact:450000,reserve:16000,retainedFloor:0,scope:'total'}};
  const saved=(await post('/policy',budget)).data;assert.ok(saved.operation.id);assert.equal(saved.policy.revision,2);
  const again=(await post('/policy',budget)).data;assert.equal(again.operation.id,saved.operation.id);assert.equal(JSON.parse(fs.readFileSync(path.join(control,'state.json'))).policies.chat.revision,2);
  const conflict=await post('/policy',{...budget,requestId:'different'});assert.equal(conflict.status,400);assert.equal(conflict.data.code,'REVISION_CONFLICT');assert.equal(conflict.data.nextAction,'refresh_chat');
 }finally{peer?.close();daemon.web.closeAllConnections();await new Promise(r=>daemon.web.close(r));await new Promise(r=>daemon.ipcServer.close(r));fs.rmSync(temp,{recursive:true,force:true});}
});
