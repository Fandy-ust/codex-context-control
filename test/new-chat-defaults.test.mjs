import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';import {PassThrough} from 'node:stream';
import {normalizeNewChatDefaults,policyForNewChat,persistedNewChatPolicy,isNewUserChat} from '../src/new-chat-defaults.mjs';import {Bridge} from '../src/bridge.mjs';
const tick=()=>new Promise(r=>setImmediate(r));
function setup(resolve){const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();const input=new PassThrough(),output=new PassThrough(),writes=[];const bridge=new Bridge(child,input,output,async()=>({}),async()=>({policy:null}),{contextCeiling:1,resolveNewChatBudget:resolve});child.stdin.on('data',d=>writes.push(...d.toString().trim().split('\n').map(JSON.parse)));output.resume();return {bridge,writes,close(){bridge.frontLines.close();bridge.backLines.close();for(const s of [child.stdin,child.stdout,input,output])s.destroy();}};}
test('new-chat defaults enforce K precision, the 920K cap and room for the next input',()=>{
 assert.deepEqual(normalizeNewChatDefaults({usableWindow:'400K',compact:'360K'}),{usableWindow:400000,compact:360000});
 for(const p of [{usableWindow:921000,compact:800000},{usableWindow:400001,compact:360000},{usableWindow:920000,compact:905000},{usableWindow:34000,compact:16000}])assert.throws(()=>normalizeNewChatDefaults(p));
 const p=policyForNewChat({usableWindow:400000,compact:360000,revision:4});assert.equal(Math.floor(p.window*.9),400000);assert.equal(p.sourceDefaultsRevision,4);assert.deepEqual(persistedNewChatPolicy(p),p);
});
test('creation uses a frozen default snapshot before the first request',async()=>{
 let defaults={usableWindow:400000,compact:360000,revision:1};let reads=0;
 const f=setup(async()=>{reads++;return {policy:policyForNewChat(defaults)};});
 try{f.bridge.fromClient(JSON.stringify({id:1,method:'thread/start',params:{model:'fixture',threadSource:'user',config:{unrelated:true,model_context_window:1022223}}}));await tick();assert.equal(reads,1);assert.equal(f.writes[0].params.config.model_context_window,444445);assert.equal(f.writes[0].params.config.unrelated,true);
 defaults={usableWindow:800000,compact:720000,revision:2};
 f.bridge.fromServer(JSON.stringify({id:1,result:{thread:{id:'new',status:{type:'idle'},ephemeral:false},model:'fixture'}}));await tick();const r=f.bridge.records.get('new');assert.equal(r.expectedWindow,400000);assert.equal(r.newChatPolicy.sourceDefaultsRevision,1);assert.equal(r.appliedRevision,1);
 }finally{f.close();}
});
test('fork, resume, temporary and managed chats never read the global defaults',async()=>{
 let reads=0;const f=setup(async()=>{reads++;throw Error('Defaults should not be read');});
 try{
  for(const [id,method,params] of [[1,'thread/start',{ephemeral:true}],[2,'thread/start',{threadSource:'mcp_extension_host'}],[3,'thread/start',{threadSource:'agent'}],[4,'thread/resume',{threadId:'old'}],[5,'thread/fork',{threadId:'old'}]])f.bridge.fromClient(JSON.stringify({id,method,params}));
  await tick();assert.equal(reads,0);assert.equal(f.writes.length,5);const fork=f.writes.find(r=>r.id===5);assert.equal(fork.params.config,undefined,'Unbudgeted forks retain native inheritance instead of being given defaults');
  assert.equal(isNewUserChat({}),true);assert.equal(isNewUserChat({forkedFromId:'parent'}),false);
 }finally{f.close();}
});
