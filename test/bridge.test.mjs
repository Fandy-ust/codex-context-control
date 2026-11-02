import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {Bridge} from '../src/bridge.mjs';

const model={slug:'fixture',effective_context_window_percent:95,max_context_window:872000};
const policy=(window,compact,revision)=>({window,compact,revision,reserve:16000,retainedFloor:0,enabled:true,scope:'total'});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const tick=()=>new Promise(r=>setImmediate(r));
test('cold resume calculates historical reasoning before its first native configuration write',async()=>{
 const f=fixture(async()=>({}));f.bridge.records.clear();f.bridge.nativeBudgetSupport=true;f.bridge.accountingWindowLimit=16000000;
 const target={...policy(871579,784000,4),effectivePercent:95};f.bridge.resolveFork=async()=>({policy:target,model});
 f.bridge.resolveCompensation=async record=>{assert.equal(record.id,'resumed');return {enabled:true,automatic:true,known:true,extraTokens:274014};};
 try{
  f.bridge.fromClient(JSON.stringify({id:1,method:'thread/resume',params:{threadId:'resumed',excludeTurns:true}}));
  await until(()=>f.writes.length===1);const request=f.writes[0];assert.equal(request.method,'thread/resume');
  assert.equal(request.params.config.model_auto_compact_token_limit,1058014);assert.ok(request.params.config.model_context_window>871579);
  assert.ok(Math.floor(request.params.config.model_context_window*.95)>=828000+274014);
  f.bridge.fromServer(JSON.stringify({id:1,result:{thread:{id:'resumed',status:{type:'idle'}},model:'fixture'}}));
  const r=f.bridge.records.get('resumed');assert.equal(r.compensation.targetWindow,828000);assert.equal(r.compensation.extraTokens,274014);assert.equal(r.policy.window,871579);assert.equal(r.appliedBudget.compact,1058014);
 }finally{f.close();}
});
async function until(fn){for(let n=0;n<100;n++){if(fn())return;await tick();}throw new Error('bridge did not settle');}
function fixture(publish){
  const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();
  const input=new PassThrough(),output=new PassThrough();const bridge=new Bridge(child,input,output,publish);
  const record=bridge.record('chat');Object.assign(record,{model:'fixture',modelInfo:model,observedWindow:665000,lastUsage:{totalTokens:120000},freshUsage:true});
  const writes=[];child.stdin.on('data',data=>writes.push(...data.toString().trim().split('\n').map(JSON.parse)));
  const close=()=>{bridge.frontLines.close();bridge.backLines.close();input.destroy();output.destroy();child.stdin.destroy();child.stdout.destroy();};
  return {bridge,record,writes,close};
}
test('tracked compaction checks the exact turn, model, budget and history before native execution and reports completion',async()=>{
 const f=fixture(async()=>({})),reports=[];f.bridge.onContextOperation=value=>reports.push(value);
 Object.assign(f.record,{turnId:'turn',policy:policy(500000,420000,1),policyVersion:1});
 const request={id:'chat',operationId:'receipt',turnId:'turn',model:'fixture',revision:1,contextEpoch:0};let calls=0;
 f.bridge.rpc=async method=>{assert.equal(method,'thread/compact/start');calls++;return {};};
 try{
  for(const change of [{turnId:'other'},{model:'other'},{revision:2},{contextEpoch:1}])await assert.rejects(f.bridge.compactTracked({...request,...change}),/changed/);
  f.bridge.external.set('pending',{threadId:'chat',method:'turn/start'});await assert.rejects(f.bridge.compactTracked(request),/changed/);f.bridge.external.clear();assert.equal(calls,0);
  await f.bridge.compactTracked(request);assert.equal(calls,1);assert.equal(f.record.locked,true);assert.equal(reports.length,0);
  f.bridge.fromServer(JSON.stringify({method:'turn/completed',params:{threadId:'chat',turn:{id:'compact-turn',status:'completed'}}}));await until(()=>reports.length===1);
  assert.equal(reports[0].state,'completed');assert.equal(reports[0].operationId,'receipt');assert.equal(f.record.locked,false);
 }finally{f.close();}
});
test('a fresh fork expands before any model request and holds the first message until reload completes',async()=>{
 const f=fixture(async()=>({})),entered=deferred(),release=deferred(),calls=[];
 Object.assign(f.record,{usageFresh:false,freshUsage:false,lastUsage:null,policy:policy(526316,473000,1),appliedRevision:1,revision:1,configuredWindow:526316,seed:{config:{model_context_window:526316,model_auto_compact_token_limit:473000}}});f.bridge.rememberAppliedBudget(f.record,f.record.policy);
 f.bridge.rpc=async(method,params)=>{calls.push({method,params});if(method==='thread/resume'){if(params.config){entered.resolve();await release.promise;}return {thread:{id:'chat',status:{type:'idle'}},model:'fixture',modelProvider:'fixture',sandbox:{type:'readOnly'}};}return {};};
 try{
  f.bridge.setPolicy('chat',policy(715790,643000,2),model);await entered.promise;
  f.bridge.fromClient(JSON.stringify({id:1,method:'turn/start',params:{threadId:'chat',input:[]}}));assert.equal(f.writes.length,0);
  release.resolve();await until(()=>f.writes.some(m=>m.method==='turn/start'));
  assert.equal(f.record.appliedRevision,2);assert.equal(f.record.expectedWindow,680000);assert.equal(f.record.freshUsage,false);assert.equal(f.record.phase,'awaiting_runtime_confirmation');
  assert.equal(calls.filter(x=>x.method==='thread/resume'&&x.params.config)[0].params.config.model_context_window,715790);assert.ok(!calls.some(x=>x.method==='model/list'||x.method==='thread/compact/start'));
 }finally{release.resolve();f.close();}
});
test('scheduled starts validate their exact source, and a user takeover while preparing prevents automatic submission',async()=>{
 const entered=deferred(),release=deferred(),f=fixture(async()=>{entered.resolve();await release.promise;return {};});
 Object.assign(f.record,{model:'fixture',inputEpoch:1,contextEpoch:0,completedTurns:new Map([['source','completed']])});
 const task={executionId:'scheduled',taskId:'handoff',prompt:'Continue original task.',schedule:{id:'handoff',sourceTurnId:'source',inputEpoch:1,contextEpoch:0,model:'fixture',policyRevision:0}};let nativeStarts=0;
 f.bridge.rpc=async()=>{nativeStarts++;return {turn:{id:'automatic',status:'inProgress'}};};
 try{
  await assert.rejects(f.bridge.startAutomatic('chat',{...task,schedule:{...task.schedule,inputEpoch:0}}),e=>e.code==='SCHEDULE_CHANGED');assert.equal(nativeStarts,0);
  const starting=f.bridge.startAutomatic('chat',task);await entered.promise;
  f.bridge.fromClient(JSON.stringify({id:900,method:'turn/start',params:{threadId:'chat',input:[{type:'text',text:'User takes over'}]}}));release.resolve();
  await assert.rejects(starting,e=>e.code==='SCHEDULE_CHANGED');assert.equal(nativeStarts,0);assert.equal(f.writes.filter(x=>x.method==='turn/start').length,1,'manual input passes through exactly once');
 }finally{release.resolve();f.close();}
});
test('a synchronous interview answer changes the handoff input epoch',()=>{
 const f=fixture(async()=>({}));try{
  const before=f.record.inputEpoch;
  f.bridge.fromServer(JSON.stringify({id:'question',method:'item/tool/requestUserInput',params:{threadId:'chat',turnId:'source',questions:[]}}));
  f.bridge.fromClient(JSON.stringify({id:'question',result:{answers:{choice:{answers:['yes']}}}}));assert.equal(f.record.inputEpoch,before+1);
 }finally{f.close();}
});
test('only a verified explicit compaction lets a handoff proceed past its stale pre-compaction counter',async()=>{
 const f=fixture(async()=>({})),calls=[];f.bridge.contextCeiling=true;
 Object.assign(f.record,{policy:policy(777778,630000,1),appliedRevision:1,inputEpoch:1,contextEpoch:0,usageFresh:false,lastUsage:{totalTokens:650000},completedTurns:new Map([['source','completed']]),completedContextOps:new Set(['compact-done'])});
 f.bridge.rpc=async(method)=>{calls.push(method);return {turn:{id:'next',status:'inProgress'}};};
 const schedule={id:'handoff',sourceTurnId:'source',inputEpoch:1,contextEpoch:0,model:'fixture',policyRevision:1};
 try{
  await assert.rejects(f.bridge.startAutomatic('chat',{executionId:'unprepared',taskId:'handoff',prompt:'Continue.',schedule}),/context decision/);assert.equal(calls.length,0);
  await f.bridge.startAutomatic('chat',{executionId:'prepared',taskId:'handoff',prompt:'Continue.',schedule:{...schedule,compactionOperationId:'compact-done'}});assert.deepEqual(calls,['turn/start']);
 }finally{f.close();}
});
test('resuming an already loaded thread cannot claim a newly injected budget was applied',async()=>{
 const f=fixture(async()=>({}));f.bridge.nativeBudgetSupport=true;f.bridge.resolveFork=async()=>({policy:policy(715790,643000,2),model});
 Object.assign(f.record,{policy:policy(526316,473000,1),policyVersion:1,appliedRevision:1,revision:1,configuredWindow:526316,usageFresh:true,seed:{config:{model_context_window:526316,model_auto_compact_token_limit:473000}}});
 try{
  f.bridge.fromClient(JSON.stringify({id:41,method:'thread/resume',params:{threadId:'chat',excludeTurns:true}}));await until(()=>f.writes.some(m=>m.id===41));
  f.bridge.fromServer(JSON.stringify({id:41,result:{thread:{id:'chat',status:{type:'idle'}},model:'fixture'}}));await tick();
  assert.equal(f.record.appliedRevision,1);assert.equal(f.record.configuredWindow,526316);assert.equal(f.record.seed.config.model_context_window,526316);
 }finally{f.close();}
});
test('local evidence applies a stale budget; missing evidence allows input without applying the budget',async()=>{
 const f=fixture(async()=>({}));f.record.usageFresh=false;f.record.freshUsage=false;let reads=0;
 f.bridge.resolveUsage=async()=>{reads++;return {known:true,model:'fixture',lastUsage:{totalTokens:120000}};};
 f.bridge.rpc=async method=>method==='thread/resume'?{thread:{id:'chat',status:{type:'idle'}},model:'fixture',modelProvider:'fixture',sandbox:{type:'readOnly'}}:{};
 try{
  f.bridge.setPolicy('chat',policy(447369,382000,2),model);await until(()=>f.record.appliedRevision===2);assert.equal(reads,1);assert.equal(f.writes.length,0);
  Object.assign(f.record,{usageFresh:false,freshUsage:false,appliedBudget:null});f.bridge.resolveUsage=async()=>({known:false});
  f.bridge.setPolicy('chat',policy(382106,326000,3),model);await until(()=>f.record.phase==='needs_observation'&&!f.record.locked);
  const responses=[];f.bridge.output.on('data',d=>responses.push(JSON.parse(d.toString())));
  f.bridge.fromClient(JSON.stringify({id:2,method:'turn/start',params:{threadId:'chat',input:[]}}));await until(()=>f.writes.length);assert.equal(responses.length,0);assert.equal(f.writes[0].id,2);assert.equal(f.record.appliedRevision,2);assert.equal(f.record.policy.revision,3);
 }finally{f.close();}
});

test('a newer budget arriving during reload applies before the queued next turn',async()=>{
  const f=fixture(async()=>({}));const entered=deferred(),release=deferred();const reloaded=[];let restores=0;
  f.bridge.rpc=async(method,params)=>{
    if(method==='thread/resume'){
      if(params.config)reloaded.push(params.config.model_context_window);
      return {thread:{id:'chat',status:{type:'idle'}},model:'fixture',modelProvider:'fixture',sandbox:{type:'readOnly'}};
    }
    if(method==='thread/settings/update'&&++restores===1){entered.resolve();await release.promise;}
    return {};
  };
  try{
    f.bridge.setPolicy('chat',policy(447369,382000,4),model);
    await entered.promise;
    f.bridge.setPolicy('chat',policy(382106,326000,5),model);
    f.bridge.fromClient(JSON.stringify({id:1,method:'turn/start',params:{threadId:'chat',input:[]}}));
    release.resolve();await until(()=>f.writes.some(m=>m.method==='turn/start'));
    assert.deepEqual(reloaded,[447369,382106]);
    assert.equal(f.record.appliedRevision,5);assert.equal(f.record.expectedWindow,363000);
    assert.equal(f.record.freshUsage,false);
    f.bridge.setPolicy('chat',policy(382106,326000,5),model);
    assert.equal(f.record.phase,'awaiting_runtime_confirmation','duplicate delivery must not reset a completed reload to queued');
  }finally{release.resolve();f.close();}
});

test('a late older policy reply cannot roll back a newer policy',async()=>{
  const reply=deferred();let calls=0;
  const f=fixture(()=>++calls===1?reply.promise:Promise.resolve({}));
  f.record.status='active';
  try{
    f.bridge.notify(f.record);
    f.bridge.setPolicy('chat',policy(382106,326000,5),model);
    reply.resolve({policy:policy(447369,382000,4),model});await tick();
    assert.equal(f.record.policy.revision,5);
  }finally{f.close();}
});

test('a newer idle budget need not wait for a model turn after an earlier reload',async()=>{
  const f=fixture(async()=>({}));const reloaded=[];
  f.bridge.rpc=async(method,params)=>{
    if(method==='thread/resume'){
      if(params.config)reloaded.push(params.config.model_context_window);
      return {thread:{id:'chat',status:{type:'idle'}},model:'fixture',modelProvider:'fixture',sandbox:{type:'readOnly'}};
    }
    return {};
  };
  try{
    f.bridge.setPolicy('chat',policy(447369,382000,4),model);
    await until(()=>f.record.appliedRevision===4&&!f.record.locked);
    assert.equal(f.record.freshUsage,false);
    f.bridge.setPolicy('chat',policy(382106,326000,5),model);
    f.bridge.fromClient(JSON.stringify({id:1,method:'turn/start',params:{threadId:'chat',input:[]}}));
    await until(()=>f.writes.some(m=>m.method==='turn/start'));
    assert.deepEqual(reloaded,[447369,382106]);
    assert.equal(f.record.appliedRevision,5);assert.equal(f.record.expectedWindow,363000);
    assert.equal(f.record.freshUsage,false);
  }finally{f.close();}
});

test('a late enabled policy reply cannot reactivate a cleared policy',async()=>{
  const reply=deferred();let calls=0;
  const f=fixture(()=>++calls===2?reply.promise:Promise.resolve({}));f.record.status='active';
  try{
    f.bridge.setPolicy('chat',policy(382106,326000,5),model);
    f.bridge.notify(f.record);f.bridge.clearPolicy('chat',6);
    reply.resolve({policy:policy(382106,326000,5),model});await tick();
    assert.equal(f.record.policy,null);
  }finally{f.close();}
});

test('a newer budget that cannot hold measured usage remains blocked after reload',async()=>{
  const f=fixture(async()=>({}));const reloaded=[];
  f.bridge.rpc=async(method,params)=>{
    if(method==='thread/resume'){
      if(params.config)reloaded.push(params.config.model_context_window);
      return {thread:{id:'chat',status:{type:'idle'}},model:'fixture',modelProvider:'fixture',sandbox:{type:'readOnly'}};
    }
    return {};
  };
  try{
    f.bridge.setPolicy('chat',policy(447369,382000,4),model);
    await until(()=>f.record.appliedRevision===4&&!f.record.locked);
    f.bridge.setPolicy('chat',policy(100000,90000,5),model);
    await tick();
    assert.equal(f.record.phase,'needs_compaction');assert.equal(f.record.appliedRevision,4);
    assert.deepEqual(reloaded,[447369]);
    await f.bridge.compact('chat');
    assert.equal(f.record.usageFresh,false);
    f.bridge.fromServer(JSON.stringify({method:'turn/completed',params:{threadId:'chat',turn:{id:'compact'}}}));await tick();
    f.bridge.setPolicy('chat',policy(382106,326000,6),model);await tick();
    assert.equal(f.record.phase,'needs_observation');assert.deepEqual(reloaded,[447369]);
  }finally{f.close();}
});

test('manual compaction rejects busy, unsupported and already submitted turns',async()=>{
  const f=fixture(async()=>({}));let calls=0;f.bridge.rpc=async()=>{calls++;return {};};
  try{
    for(const state of [{status:'active'},{status:'idle',locked:true},{locked:false,ephemeral:true},{ephemeral:false,canAcceptDirectInput:false}]){
      Object.assign(f.record,state);await assert.rejects(f.bridge.compact('chat'),/请等待/);
    }
    Object.assign(f.record,{canAcceptDirectInput:true});
    f.bridge.fromClient(JSON.stringify({id:10,method:'turn/start',params:{threadId:'chat',input:[]}}));
    await assert.rejects(f.bridge.compact('chat'),/请等待/);assert.equal(calls,0);
  }finally{f.close();}
});

test('manual compaction holds new input until completion and rejects duplicate clicks',async()=>{
  const f=fixture(async()=>({}));const calls=[];f.bridge.rpc=async(method,params)=>{calls.push({method,params});return {};};
  try{
    assert.equal((await f.bridge.compact('chat')).started,true);
    await assert.rejects(f.bridge.compact('chat'),/请等待/);
    f.bridge.fromClient(JSON.stringify({id:11,method:'turn/start',params:{threadId:'chat',input:[]}}));
    assert.equal(f.writes.length,0);assert.equal(f.record.locked,true);
    assert.deepEqual(calls,[{method:'thread/compact/start',params:{threadId:'chat'}}]);
    f.bridge.fromServer(JSON.stringify({method:'turn/completed',params:{threadId:'chat',turn:{id:'compact'}}}));await tick();
    assert.equal(f.record.locked,false);assert.equal(f.writes[0].method,'turn/start');
  }finally{f.close();}
});

test('manual compaction failure releases the lock without sending queued input',async()=>{
  const f=fixture(async()=>({}));const started=deferred(),release=deferred();
  f.bridge.rpc=async()=>{started.resolve();await release.promise;throw Error('native failed');};
  try{
    const pending=f.bridge.compact('chat');await started.promise;
    f.bridge.fromClient(JSON.stringify({id:12,method:'turn/start',params:{threadId:'chat',input:[]}}));
    release.resolve();await assert.rejects(pending,/native failed/);
    assert.equal(f.record.locked,false);assert.equal(f.record.compactionWait,null);assert.equal(f.record.phase,'error');assert.equal(f.writes.length,0);
  }finally{release.resolve();f.close();}
});

test('disabling compensation retries restoration after stale usage and a desktop resume',async()=>{
 const f=fixture(async()=>({}));const reloaded=[];
 try{
  const budget=policy(600000,500000,1);
  Object.assign(f.record,{status:'idle',policy:budget,appliedRevision:1,revision:1,usageFresh:false,compensation:{enabled:true,status:'active',extraTokens:100000,targetWindow:570000,runtimeWindow:670000},compensationKey:'previously applied enlarged budget'});
  f.bridge.resolveCompensation=async()=>({enabled:false});
  f.bridge.rpc=async(method,params)=>{if(method==='thread/resume'){if(params.config)reloaded.push(params.config);return {thread:{id:'chat',status:{type:'idle'}},model:'fixture',modelProvider:'fixture',sandbox:{type:'readOnly'}};}return {};};
  await f.bridge.syncCompensation(f.record);
  assert.equal(reloaded.length,0);assert.equal(f.record.compensation.enabled,true,'pending disable must not erase the applied runtime');assert.equal(f.record.compensation.pendingEnabled,false);
  f.bridge.external.set(JSON.stringify('resume'),{method:'thread/resume',threadId:'chat',seed:{config:{}},fork:{resume:true,resumePolicy:budget,preserveUsage:true,wasLoaded:true}});
  f.bridge.fromServer(JSON.stringify({id:'resume',result:{thread:{id:'chat',status:{type:'idle'}},model:'fixture',modelProvider:'fixture'}}));
  assert.equal(f.record.compensation.enabled,true);assert.equal(f.record.compensationKey,'previously applied enlarged budget');
  f.record.usageFresh=true;
  await f.bridge.syncCompensation(f.record);
  assert.equal(reloaded.length,1);assert.equal(reloaded[0].model_context_window,600000);assert.equal(reloaded[0].model_auto_compact_token_limit,500000);assert.equal(f.record.compensation.enabled,false);
  await f.bridge.syncCompensation(f.record);assert.equal(reloaded.length,1,'unchanged off state must not reload repeatedly');
 }finally{f.close();}
});

test('off state with a mismatched readback restores the base window even after old bookkeeping was lost',async()=>{
 const f=fixture(async()=>({}));const applied=[];
 try{
  const budget=policy(600000,500000,1);Object.assign(f.record,{status:'idle',policy:budget,appliedRevision:1,usageFresh:true,compensation:null,compensationKey:null,observedWindow:670000});
  f.bridge.resolveCompensation=async()=>({enabled:false});
  f.bridge.rpc=async(method,params)=>{if(method==='thread/resume'){if(params.config)applied.push(params.config);return {thread:{id:'chat',status:{type:'idle'}},model:'fixture',modelProvider:'fixture',sandbox:{type:'readOnly'}};}return {};};
  await f.bridge.syncCompensation(f.record);assert.equal(applied.length,1);assert.equal(applied[0].model_context_window,600000);assert.equal(f.record.expectedWindow,570000);assert.equal(f.record.compensation.enabled,false);
  await f.bridge.syncCompensation(f.record);assert.equal(applied.length,1,'a stale readback immediately after reload is not another mismatch');
 }finally{f.close();}
});

test('disabling stops compensation-triggered compaction even before the enlarged window is restored',async()=>{
 const f=fixture(async()=>({}));let called=0;
 try{
  Object.assign(f.record,{status:'idle',policy:policy(600000,500000,1),usageFresh:true,lastUsage:{totalTokens:510000},compensation:{enabled:true,status:'waiting',pendingEnabled:false}});
  f.bridge.resolveCompensation=Object.assign(async()=>({enabled:false}),{isEnabled:()=>false});f.bridge.compact=async()=>{called++;};
  f.bridge.scheduleCompensatedCompaction(f.record);await tick();assert.equal(called,0);
 }finally{f.close();}
});


test('model switch without local usage allows one manual turn, then applies the pending budget after fresh usage',async()=>{
 const f=fixture(async()=>({}));const calls=[];
 f.bridge.resolveUsage=async()=>({known:false});
 f.bridge.rpc=async(method,params)=>{calls.push({method,params});return method==='thread/resume'?{thread:{id:'chat',status:{type:'idle'}},model:'fixture',modelProvider:'fixture',sandbox:{type:'readOnly'}}:{};};
 try{
  Object.assign(f.record,{policy:policy(447369,382000,2),policyVersion:2,appliedRevision:1,appliedBudget:null,usageFresh:false,freshUsage:false});
  const blocked=deferred();f.bridge.resolveUsage=async()=>{await blocked.promise;return {known:false};};
  const applying=f.bridge.apply(f.record);
  f.bridge.fromClient(JSON.stringify({id:301,method:'turn/start',params:{threadId:'chat',input:[{type:'text',text:'hello'}]}}));
  assert.equal(f.writes.length,0);blocked.resolve();await applying;
  assert.equal(f.writes.filter(m=>m.method==='turn/start').length,1);
  assert.equal(f.record.appliedRevision,1);assert.equal(calls.length,0,'no reload without evidence');
  f.bridge.fromServer(JSON.stringify({id:301,result:{turn:{id:'turn-301'}}}));
  f.bridge.fromServer(JSON.stringify({method:'turn/started',params:{threadId:'chat',turn:{id:'turn-301'}}}));
  f.bridge.fromServer(JSON.stringify({method:'thread/tokenUsage/updated',params:{threadId:'chat',tokenUsage:{modelContextWindow:665000,last:{totalTokens:125000}}}}));
  f.bridge.fromServer(JSON.stringify({method:'thread/status/changed',params:{threadId:'chat',status:{type:'idle'}}}));
  await until(()=>f.record.appliedRevision===2&&!f.record.locked);
  assert.ok(calls.some(c=>c.method==='thread/resume'&&c.params.config));
  assert.equal(f.writes.filter(m=>m.method==='turn/start').length,1,'never replay the user input');
 }finally{f.close();}
});

test('scheduled apply cannot reload after an observation turn has already been submitted',async()=>{
 const f=fixture(async()=>({}));let calls=0;f.bridge.resolveUsage=async()=>{calls++;return {known:false};};
 try{
  f.record.usageFresh=false;f.record.freshUsage=false;
  f.bridge.setPolicy('chat',policy(447369,382000,2),model);
  f.bridge.fromClient(JSON.stringify({id:302,method:'turn/start',params:{threadId:'chat',input:[]}}));
  await tick();assert.equal(f.writes.length,1);assert.equal(calls,0);assert.equal(f.record.locked,false);
 }finally{f.close();}
});

test('automatic task can obtain missing usage without applying an unverified budget',async()=>{
 const f=fixture(async()=>({}));const calls=[];
 Object.assign(f.record,{usageFresh:false,freshUsage:false,appliedBudget:null});
 f.bridge.resolveUsage=async()=>({known:false});
 f.bridge.rpc=async(method,params)=>{calls.push({method,params});return {turn:{id:'queued-observation',status:'inProgress'}};};
 try{
  f.bridge.setPolicy('chat',policy(447369,382000,2),model);
  await tick();await until(()=>!f.record.locked&&f.record.phase==='needs_observation');
  const result=await f.bridge.startAutomatic('chat',{executionId:'observe-1',taskId:'task-1',prompt:'continue'});
  assert.equal(result.status,'running');assert.equal(calls.filter(c=>c.method==='turn/start').length,1);
  assert.equal(f.record.appliedRevision,undefined);assert.ok(!calls.some(c=>c.method==='thread/resume'));
 }finally{f.close();}
});

test('measured over-capacity and reload errors still reject manual input',async()=>{
 for(const phase of ['needs_compaction','error']){
  const f=fixture(async()=>({}));const responses=[];f.bridge.output.on('data',d=>responses.push(JSON.parse(d.toString())));
  try{
   Object.assign(f.record,{policy:policy(100000,90000,2),phase,message:'blocked',appliedRevision:1});
   f.bridge.fromClient(JSON.stringify({id:303,method:'turn/start',params:{threadId:'chat',input:[]}}));
   assert.equal(f.writes.length,0);assert.equal(responses[0].error.message,'Context Control: blocked');
  }finally{f.close();}
 }
});
