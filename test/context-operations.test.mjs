import test from 'node:test';
import assert from 'node:assert/strict';
import {createContextOperations} from '../src/context-operations.mjs';
import {contextSnapshot,contextPreflight} from '../src/core/context-snapshot.mjs';
import {runManagerCLI} from '../src/manager-cli.mjs';

const policy={window:500000,compact:420000,reserve:16000,retainedFloor:0,scope:'total',revision:1};
const model={effective_context_window_percent:95,max_context_window:872000};
const thread={id:'chat',model:'fixture',status:'active',turnId:'turn',policy,connected:true,usageFresh:true,lastUsage:{totalTokens:100000},appliedBudget:policy,expectedWindow:475000,observedWindow:475000,revision:1,modelMetadata:model};
function fixture(){let clock=0,serial=0,saved=[];const options={load:()=>saved,save:value=>{saved=structuredClone(value);},now:()=>clock,id:()=>String(++serial)};return {operations:createContextOperations(options),options,advance:()=>{clock+=16*60*1000;}};}
function compact(ops){const o=ops.create({threadId:'chat',kind:'compact',requestId:'compact-1',fingerprint:'compact',turnId:'turn',model:'fixture',revision:1});return ops.transition(o.id,'chat',{state:'waiting_for_idle'});}
test('receipts deduplicate, reject conflicting reuse, bind to the chat and cannot cancel execution',()=>{
 const {operations:o}=fixture(),request=compact(o);
 assert.equal(o.replay('chat','compact-1','compact').id,request.id);
 assert.throws(()=>o.replay('chat','compact-1','other'),e=>e.code==='REQUEST_ID_CONFLICT');
 assert.throws(()=>o.get(request.id,'another'),e=>e.code==='OPERATION_NOT_FOUND');
 o.transition(request.id,'chat',{state:'executing'});assert.throws(()=>o.cancel(request.id,'chat'),e=>e.code==='NOT_CANCELLABLE');
 o.transition(request.id,'chat',{state:'completed'});o.transition(request.id,'chat',{state:'executing'});assert.equal(o.get(request.id,'chat').state,'completed');
});
test('deferred compaction cancels on user cancellation, interrupted turns, changed turns, models and budgets',()=>{
 for(const change of [{turnId:'new'},{model:'new'},{policy:{...policy,revision:2}},{status:'idle',lastTurnStatus:'interrupted'}]){
  const {operations:o}=fixture(),request=compact(o);o.observe({...thread,...change});assert.ok(['cancelled','superseded'].includes(o.get(request.id,'chat').state));
 }
 const {operations:o}=fixture(),request=compact(o);assert.equal(o.cancel(request.id,'chat').state,'cancelled');
});
test('waiting compaction expires; a restart does not replay pending or uncertain actions',()=>{
 const f=fixture(),request=compact(f.operations);f.advance();assert.equal(f.operations.get(request.id,'chat').state,'expired');
 const pending=f.operations.create({threadId:'chat',kind:'compact',requestId:'pending',fingerprint:'pending'});f.operations.transition(pending.id,'chat',{state:'waiting_for_idle'});
 const running=f.operations.create({threadId:'chat',kind:'compact',requestId:'running',fingerprint:'running'});f.operations.transition(running.id,'chat',{state:'executing'});
 const restarted=createContextOperations(f.options);assert.equal(restarted.get(pending.id,'chat').state,'cancelled');assert.equal(restarted.get(running.id,'chat').state,'outcome_unknown');assert.equal(restarted.pending('chat').length,0);
});
test('budget receipts require the exact revision and phase to confirm',()=>{
 const {operations:o}=fixture();const request=o.create({threadId:'chat',kind:'budget',requestId:'set',fingerprint:'set',revision:2});
 o.observe({...thread,policy:{...policy,revision:2},revision:1,phase:'confirmed'});assert.notEqual(o.get(request.id,'chat').state,'confirmed');
 o.observe({...thread,policy:{...policy,revision:2},revision:2,phase:'awaiting_runtime_confirmation'});assert.equal(o.get(request.id,'chat').state,'awaiting_readback');
 o.observe({...thread,policy:{...policy,revision:2},revision:2,phase:'confirmed'});assert.equal(o.get(request.id,'chat').state,'confirmed');
});
test('preflight separates validity, evidence, execution and registration without mutating the chat',()=>{
 const before=structuredClone(thread),result=contextPreflight(thread,policy,model);
 assert.equal(result.budgetValid,true);assert.equal(result.evidence.sufficient,true);assert.equal(result.execution.canExecuteNow,false);assert.equal(result.execution.when,'idle');assert.equal(result.registered,false);assert.doesNotMatch(result.message,/已排队/);assert.deepEqual(thread,before);
 const offline=contextPreflight({...thread,status:'idle',connected:false},policy,model);assert.equal(offline.allowed,false);assert.ok(offline.execution.blockers.includes('waiting_bridge'));
 assert.equal(contextPreflight(thread,{...policy,window:900000},model).budgetValid,false);
});
test('snapshot distinguishes pending targets, loaded budgets and stale measurements',()=>{
 const value=contextSnapshot({...thread,policy:{...policy,window:700000,revision:2},usageFresh:false});
 assert.equal(value.requested.window,665000);assert.equal(value.loaded.window,475000);assert.equal(value.loaded.revision,1);assert.equal(value.headroom.toWindow,null);assert.equal(value.observation.totalTokens,100000);assert.equal(value.observation.validForPreflight,false);
});
test('current is explicit, summary and operation commands use scoped routes, and compact accepts a stable request ID',async()=>{
 const calls=[],env={CODEX_THREAD_ID:'01a1976e-6204-7de3-be1d-c3849e30a996'},client=async(op,p)=>{calls.push({op,p});return {};};
 await assert.rejects(runManagerCLI(['chat','show','current'],{client,env:{}}),e=>e.code==='CURRENT_CHAT_UNKNOWN');assert.equal(calls.length,0);
 await runManagerCLI(['chat','show','current','--summary'],{client,env});assert.deepEqual(calls.pop(),{op:'chat',p:{id:env.CODEX_THREAD_ID,summary:true}});
 await runManagerCLI(['chat','compact','current','--when-idle','--request-id','confirmed-1'],{client,env});assert.deepEqual(calls.pop(),{op:'compact',p:{id:env.CODEX_THREAD_ID,track:true,whenIdle:true,requestId:'confirmed-1'}});
 await runManagerCLI(['chat','operation','current','receipt-1'],{client,env});assert.deepEqual(calls.pop(),{op:'context-operation',p:{id:env.CODEX_THREAD_ID,action:'show',operationId:'receipt-1'}});
 await runManagerCLI(['chat','speed','current','--summary'],{client,env});assert.equal(calls.pop().op,'speed-report');
});
