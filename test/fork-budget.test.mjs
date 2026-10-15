import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {Bridge} from '../src/bridge.mjs';
import {inheritedForkPolicy} from '../src/fork-budget.mjs';

const source={window:382106,compact:326000,reserve:16000,retainedFloor:100000,scope:'total',revision:5,enabled:true};
const model={slug:'fixture',effective_context_window_percent:95,max_context_window:872000};
const tick=()=>new Promise(r=>setImmediate(r));
async function until(fn){for(let i=0;i<100;i++){if(fn())return;await tick();}throw new Error('fork did not settle');}
function fixture(resolve){
  const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();
  const input=new PassThrough(),output=new PassThrough(),writes=[],publications=[],responses=[];
  const bridge=new Bridge(child,input,output,async r=>{publications.push(r);return {};},resolve);
  child.stdin.on('data',d=>writes.push(...d.toString().trim().split('\n').map(JSON.parse)));
  output.on('data',d=>responses.push(...d.toString().trim().split('\n').map(JSON.parse)));
  return {bridge,writes,publications,responses,close(){bridge.frontLines.close();bridge.backLines.close();input.destroy();output.destroy();child.stdin.destroy();child.stdout.destroy();}};
}

test('fork injects the saved parent budget before creation and preserves unrelated settings',async()=>{
  const original=structuredClone(source);const f=fixture(async id=>{assert.equal(id,'parent');return {policy:source,model};});
  try{
    f.bridge.fromClient(JSON.stringify({id:1,method:'thread/fork',params:{threadId:'parent',excludeTurns:true,approvalPolicy:'never',sandbox:'read-only',config:{unrelated:true,model_context_window:872000}}}));
    await until(()=>f.writes.length);
    assert.deepEqual(f.writes[0].params,{threadId:'parent',excludeTurns:true,approvalPolicy:'never',sandbox:'read-only',config:{unrelated:true,model_context_window:382106,model_auto_compact_token_limit:326000,model_auto_compact_token_limit_scope:'total'}});
    // A later parent edit must not change the snapshot being inherited.
    source.window=700000;
    f.bridge.fromServer(JSON.stringify({id:1,result:{thread:{id:'child',forkedFromId:'parent',status:{type:'idle'}},model:'fixture'}}));
    const child=f.bridge.records.get('child');
    assert.equal(child.policy.window,382106);assert.equal(child.policy.revision,1);assert.equal(child.policy.inheritedFromRevision,5);
    assert.equal(child.expectedWindow,363000);assert.equal(child.freshUsage,false);
    assert.equal(child.policy.reserve,16000);assert.equal(child.policy.retainedFloor,100000);
    assert.equal(f.publications.at(-1).forkPolicy.window,382106);
  }finally{Object.assign(source,original);f.close();}
});

test('disabled, absent, path-selected and ephemeral parent budgets do not enable inheritance',async()=>{
  for(const [policy,extra] of [[null,{}],[{...source,enabled:false},{}],[source,{path:'/different-parent.jsonl'}],[source,{ephemeral:true}]]){
    const f=fixture(async()=>({policy,model}));
    try{
      const request={id:1,method:'thread/fork',params:{threadId:'parent',...extra}};
      f.bridge.fromClient(JSON.stringify(request));await until(()=>f.writes.length);
      assert.deepEqual(f.writes[0],request);
      f.bridge.fromServer(JSON.stringify({id:1,result:{thread:{id:'child',status:{type:'idle'},ephemeral:extra.ephemeral},model:'fixture'}}));
      assert.equal(f.bridge.records.get('child').policy,undefined);
    }finally{f.close();}
  }
});

test('fork failure creates no policy and a known smaller model limit is not bypassed',async()=>{
  const f=fixture(async()=>({policy:source,model}));
  try{
    f.bridge.fromClient(JSON.stringify({id:1,method:'thread/fork',params:{threadId:'parent'}}));await until(()=>f.writes.length);
    f.bridge.fromServer(JSON.stringify({id:1,error:{code:-1,message:'fixture failure'}}));
    assert.equal(f.bridge.records.size,0);assert.equal(f.publications.length,0);
  }finally{f.close();}
  const small=fixture(async()=>({policy:source,model:{...model,max_context_window:272000}}));
  try{
    small.bridge.fromClient(JSON.stringify({id:2,method:'thread/fork',params:{threadId:'parent'}}));await until(()=>small.responses.length);
    assert.equal(small.writes.length,0);assert.match(small.responses[0].error.message,/上限/);
  }finally{small.close();}
  const unknown=fixture(async()=>({policy:source,model:null}));
  Object.assign(unknown.bridge.record('parent'),{model:'fixture',modelInfo:model,policy:source});
  try{
    unknown.bridge.fromClient(JSON.stringify({id:3,method:'thread/fork',params:{threadId:'parent',model:'unknown-target'}}));await until(()=>unknown.responses.length);
    assert.equal(unknown.writes.length,0);assert.match(unknown.responses[0].error.message,/模型/);
  }finally{unknown.close();}
});

test('a nested fork receives an independent snapshot with its own revision sequence',()=>{
  const child=inheritedForkPolicy(source,'parent');const grandchild=inheritedForkPolicy({...child,window:210527,compact:180000,revision:2},'child');
  assert.equal(child.window,382106);assert.equal(grandchild.window,210527);
  assert.equal(grandchild.revision,1);assert.equal(grandchild.inheritedFrom,'child');assert.equal(grandchild.inheritedFromRevision,2);
  grandchild.window=400000;assert.equal(child.window,382106);assert.equal(source.window,382106);
});
