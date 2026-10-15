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
    f.bridge.setPolicy('chat',policy(382106,326000,6),model);await tick();
    assert.equal(f.record.phase,'needs_observation');assert.deepEqual(reloaded,[447369]);
  }finally{f.close();}
});
