import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {Bridge} from '../src/bridge.mjs';

const model={slug:'fixture',effective_context_window_percent:95,max_context_window:872000};
const policy=(window,compact,revision)=>({window,compact,revision,reserve:16000,retainedFloor:0,enabled:true,scope:'total'});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const tick=()=>new Promise(r=>setImmediate(r));
async function until(fn){for(let n=0;n<100;n++){if(fn())return;await tick();}throw new Error('bridge did not settle');}
function fixture(publish){
  const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();
  const input=new PassThrough(),output=new PassThrough();const bridge=new Bridge(child,input,output,publish);
  const record=bridge.record('chat');Object.assign(record,{model:'fixture',modelInfo:model,observedWindow:665000,lastUsage:{totalTokens:120000},freshUsage:true});
  const writes=[];child.stdin.on('data',data=>writes.push(...data.toString().trim().split('\n').map(JSON.parse)));
  const close=()=>{bridge.frontLines.close();bridge.backLines.close();input.destroy();output.destroy();child.stdin.destroy();child.stdout.destroy();};
  return {bridge,record,writes,close};
}

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
  f.bridge.external.set(JSON.stringify('resume'),{method:'thread/resume',threadId:'chat',seed:{config:{}},fork:{resume:true,resumePolicy:budget,preserveUsage:true}});
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
