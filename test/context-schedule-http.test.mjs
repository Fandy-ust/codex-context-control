import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('handoff HTTP returns context and readiness, then the existing scheduler dispatches once after exact completion',async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'cm-handoff-http-')),control=path.join(temp,'control'),home=path.join(temp,'codex');fs.mkdirSync(control);fs.mkdirSync(home);
 fs.copyFileSync(new URL('fixtures/models.json',import.meta.url),path.join(home,'models_cache.json'));
 const policy={window:421053,compact:350000,reserve:16000,retainedFloor:0,scope:'total',revision:1,enabled:true};
 fs.writeFileSync(path.join(control,'state.json'),JSON.stringify({version:2,policies:{chat:policy},threads:{chat:{id:'chat',model:'context-fixture'},other:{id:'other',model:'context-fixture'}}}));
 process.env.CONTEXT_CONTROL_HOME=control;process.env.CONTEXT_CONTROL_CODEX_HOME=home;
 const {startDaemon}=await import('../src/daemon.mjs'),{connect}=await import('../src/ipc.mjs'),daemon=await startDaemon();let peer;const starts=[];
 try{
  const c=JSON.parse(fs.readFileSync(path.join(control,'connection.json'))),base=`http://127.0.0.1:${c.port}`,headers={Authorization:`Bearer ${c.token}`};
  const post=async(body)=>{const response=await fetch(base+'/context-schedule',{method:'POST',headers,body:JSON.stringify(body)});return {status:response.status,data:await response.json()};};
  peer=await connect(async(op,p)=>{if(op==='queue-start'){starts.push(p.task);return {executionId:p.task.executionId,status:'running',turnId:'next'};}throw Error(op);});
  await peer.call('registerBridge',{pid:process.pid,taskQueueVersion:4,contextScheduleVersion:1});
  const update=change=>peer.call('updateThread',{id:'chat',model:'context-fixture',status:'active',turnId:'source',inputEpoch:1,contextEpoch:0,revision:1,phase:'confirmed',expectedWindow:400000,appliedBudget:policy,usageFresh:true,lastUsage:{totalTokens:100000},...change});await update();
  await peer.call('observeQuota',{account:{type:'chatgpt',id:'fixture-account',email:'fixture@example.test'},observedAt:Date.now(),rateLimitsByLimitId:{codex:{credits:{hasCredits:true,unlimited:false,balance:'120'},primary:{usedPercent:10,windowDurationMins:300,resetsAt:Math.floor(Date.now()/1000)+3600},secondary:{usedPercent:100,windowDurationMins:10080,resetsAt:Math.floor(Date.now()/1000)+86400}}}});
  const request={id:'chat',action:'schedule',prompt:'Continue the unfinished original task after checking its saved progress.',requestId:'confirmed-handoff'};
  const accepted=await post(request);assert.equal(accepted.status,200);assert.equal(accepted.data.nextAction,'finish_turn');assert.match(accepted.data.agentInstruction,/结束当前轮次/);assert.match(accepted.data.agentInstruction,/等待下一条消息/);assert.equal(accepted.data.context.headroom.toWindow,284000);assert.equal(accepted.data.readiness.quotaBlocked,false);assert.equal(accepted.data.readiness.quotaSource,'credits');assert.equal(starts.length,0);
  assert.equal((await post(request)).data.schedule.id,accepted.data.schedule.id);
  const configure=async config=>{const r=await fetch(base+'/quota/activation',{method:'POST',headers,body:JSON.stringify({action:'configure',...config})});assert.equal(r.status,200);await r.json();};
  await configure({stopOnCreditsEnabled:true,creditsTrigger:'either'});const protectedReceipt=await post(request);assert.equal(protectedReceipt.data.readiness.quotaBlocked,true);assert.equal(protectedReceipt.data.readiness.quotaReason,'credits_protection');
  await configure({stopOnCreditsEnabled:false});assert.equal((await post(request)).data.readiness.quotaSource,'credits');
  await update({status:'idle'});await new Promise(r=>setTimeout(r,30));assert.equal(starts.length,0);
  await update({status:'idle',lastCompletedTurnId:'source',lastTurnStatus:'completed'});
  for(let i=0;i<100&&!starts.length;i++)await new Promise(r=>setTimeout(r,20));assert.equal(starts.length,1);assert.equal(starts[0].schedule.sourceTurnId,'source');
  await update({status:'idle',turnId:'next',inputEpoch:2,lastCompletedTurnId:'next',lastTurnStatus:'completed',automaticTask:{executionId:starts[0].executionId,status:'completed',turnId:'next'}});
  let list;for(let i=0;i<100;i++){list=(await post({id:'chat',action:'list'})).data.schedules;if(list[0]?.state==='completed')break;await new Promise(r=>setTimeout(r,20));}assert.equal(list[0].state,'completed');assert.equal(starts.length,1);
  const replay=await post(request);assert.equal(replay.data.schedule.state,'completed');assert.equal(replay.data.nextAction,'inspect_schedule');assert.doesNotMatch(replay.data.agentInstruction,/请保存交接进展并结束/);
  await update({inputEpoch:3,turnId:'source-2'});const pending=(await post({...request,requestId:'cancelled-handoff'})).data.schedule;
  assert.equal((await post({id:'other',action:'cancel',scheduleId:pending.id})).data.code,'SCHEDULE_NOT_FOUND');
  assert.equal((await post({id:'chat',action:'cancel',scheduleId:pending.id})).data.schedule.state,'cancelled');
 }finally{peer?.close();daemon.web.closeAllConnections();await new Promise(r=>daemon.web.close(r));await new Promise(r=>daemon.ipcServer.close(r));fs.rmSync(temp,{recursive:true,force:true});}
});
