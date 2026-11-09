import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {Bridge} from '../src/bridge.mjs';
import {policyForNewChat} from '../src/new-chat-defaults.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));

async function fixture(thread={}){
 const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();
 const input=new PassThrough(),output=new PassThrough(),writes=[],replies=[];let checks=0;
 const policy=policyForNewChat({usableWindow:400000,compact:360000,revision:1});
 const bridge=new Bridge(child,input,output,async()=>({}),async()=>({policy:null}),{
  contextCeiling:1,resolveNewChatBudget:async()=>({policy}),
  resolveCompensation:async()=>{checks++;return {enabled:true,automatic:true,known:false,reason:'history'};}
 });
 child.stdin.on('data',v=>writes.push(...v.toString().trim().split('\n').map(JSON.parse)));
 output.on('data',v=>replies.push(...v.toString().trim().split('\n').map(JSON.parse)));
 bridge.fromClient(JSON.stringify({id:1,method:'thread/start',params:{model:'fixture'}}));await tick();
 bridge.fromServer(JSON.stringify({id:1,result:{model:'fixture',thread:{id:'new',status:{type:'idle'},turns:[],...thread}}}));await tick();
 return {bridge,writes,replies,checks:()=>checks,policy,send(id=2,input='hello'){bridge.fromClient(JSON.stringify({id,method:'turn/start',params:{threadId:'new',input:[{type:'text',text:input}]}}));},close(){bridge.frontLines.close();bridge.backLines.close();for(const stream of [input,output,child.stdin,child.stdout])stream.destroy();}};
}

test('fresh first turn uses the loaded budget without model metadata or history; second turn checks even without usage',async()=>{
 const f=await fixture();
 try{
  assert.equal(f.bridge.records.get('new').modelInfo,undefined);
  assert.equal(f.writes[0].params.config.model_context_window,f.policy.window);
  assert.equal(f.writes[0].params.config.model_auto_compact_token_limit,f.policy.compact);
  f.send();await tick();
  assert.equal(f.checks(),0);assert.equal(f.writes.filter(v=>v.method==='turn/start').length,1);
  f.bridge.fromServer(JSON.stringify({id:2,result:{turn:{id:'first'}}}));
  f.bridge.fromServer(JSON.stringify({method:'turn/completed',params:{threadId:'new',turn:{id:'first',status:'interrupted'}}}));
  f.send(3);await tick();
  assert.equal(f.checks(),1);
  assert.match(f.replies.find(v=>v.id===3).error.message,/历史/);
  assert.equal(f.writes.filter(v=>v.method==='turn/start').length,1);
 }finally{f.close();}
});

test('first-turn exemption is consumed on submission even if no turn notification arrives',async()=>{
 const f=await fixture();
 try{
  f.send();await tick();
  f.bridge.fromServer(JSON.stringify({id:2,error:{message:'rejected'}}));
  f.send(3);await tick();
  assert.equal(f.checks(),1);
  assert.ok(f.replies.find(v=>v.id===3)?.error);
 }finally{f.close();}
});

for(const [name,thread] of [['inherited',{forkedFromId:'parent'}],['existing turns',{turns:[{id:'old',status:'completed'}]}]]){
 test(name+' never qualifies for the empty first-turn exemption',async()=>{
  const f=await fixture(thread);
  try{
   // A fork may receive its policy from the controller after creation.
   const r=f.bridge.records.get('new');r.policy??=f.policy;r.appliedRevision=f.policy.revision;
   f.send();await tick();assert.equal(f.checks(),1);assert.ok(f.replies.find(v=>v.id===2)?.error);
  }finally{f.close();}
 });
}
test('resume never restores the first-turn exemption',async()=>{
 const f=await fixture();
 try{
  f.bridge.fromClient(JSON.stringify({id:4,method:'thread/resume',params:{threadId:'new'}}));await tick();
  f.bridge.fromServer(JSON.stringify({id:4,result:{model:'fixture',thread:{id:'new',status:{type:'idle'},turns:[]}}}));await tick();
  f.send();await tick();assert.equal(f.checks(),1);assert.ok(f.replies.find(v=>v.id===2)?.error);
 }finally{f.close();}
});
test('first turn still enforces the input capacity guard',async()=>{
 const f=await fixture();
 try{
  const r=f.bridge.records.get('new');r.expectedWindow=16001;
  f.send(2,'hello '.repeat(30));await tick();
  assert.equal(f.checks(),0);assert.match(f.replies.find(v=>v.id===2).error.message,/拆分输入/);
  assert.equal(f.writes.filter(v=>v.method==='turn/start').length,0);
  assert.equal(r.initialTurnWithoutHistory,true);
 }finally{f.close();}
});
test('second turn proceeds after historical accounting succeeds',async()=>{
 const f=await fixture();
 try{
  f.send();await tick();
  f.bridge.fromServer(JSON.stringify({id:2,result:{turn:{id:'first'}}}));
  f.bridge.fromServer(JSON.stringify({method:'turn/completed',params:{threadId:'new',turn:{id:'first',status:'completed'}}}));
  const r=f.bridge.records.get('new');r.modelInfo={slug:'fixture',effective_context_window_percent:90,max_context_window:1022223};
  let reads=0;f.bridge.resolveCompensation=async()=>{reads++;return {enabled:true,automatic:true,known:true,extraTokens:0};};
  f.send(3);await tick();
  assert.equal(reads,1);assert.equal(f.writes.filter(v=>v.method==='turn/start').length,2);
  assert.equal(f.replies.find(v=>v.id===3)?.error,undefined);
 }finally{f.close();}
});
test('automatic first turn shares the exemption and consumes it before submission',async()=>{
 const f=await fixture();
 try{
  f.bridge.rpc=async(method)=>{assert.equal(method,'turn/start');assert.equal(f.bridge.records.get('new').initialTurnWithoutHistory,false);return {turn:{id:'auto-first',status:'inProgress'}};};
  const result=await f.bridge.startAutomatic('new',{taskId:'task',executionId:'exec',prompt:'hello',settings:{}});
  assert.equal(result.turnId,'auto-first');assert.equal(f.checks(),0);
 }finally{f.close();}
});
