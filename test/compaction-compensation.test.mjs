import test from 'node:test';
import assert from 'node:assert/strict';
import {activeReasoningEstimate,projectCompensationEvent,reasoningEstimate,compensationBudget} from '../src/core/compaction-compensation.mjs';
import {windowConfirmed} from '../src/presentation/chat.mjs';
const model={effective_context_window_percent:95,max_context_window:872000};
const policy={window:421053,compact:360000,reserve:16000,revision:1,enabled:true};
const event=(type,payload,originThreadId='chat')=>projectCompensationEvent({type,payload,originThreadId});
const reasoning=(id,n)=>({id,type:'reasoning',encrypted_content:'A'.repeat(n),summary:[{text:'private'}]});
test('active history uses lengths only, replaces checkpoints and ignores superseded item versions',()=>{
 const old=event('response_item',reasoning('r',16000));assert.equal(reasoningEstimate(16000),2838);assert.equal(reasoningEstimate(24000),4338);
 assert.ok(!JSON.stringify(old).includes('AAAA'));assert.ok(!JSON.stringify(old).includes('private'));
 const events=[old,event('response_item',reasoning('r',24000)),event('event_msg',{type:'task_complete',turn_id:'turn'})];
 assert.deepEqual(activeReasoningEstimate(events,{threadId:'chat',completedTurnId:'turn'}),{known:true,extraTokens:4338});
 assert.equal(activeReasoningEstimate(events,{threadId:'chat',completedTurnId:'later'}).known,false);
 events.push(event('compacted',{replacement_history:[reasoning('kept',16000)]}));
 assert.equal(activeReasoningEstimate(events).extraTokens,2838);
 events.push(event('event_msg',{type:'thread_rolled_back'}));assert.equal(activeReasoningEstimate(events).known,false);
 events.push(event('compacted',{replacement_history:[]}));assert.equal(activeReasoningEstimate(events).extraTokens,0);
 events.push(event('compacted',{}));assert.equal(activeReasoningEstimate(events).known,false);
});
test('compensation leaves the logical policy intact, reserves physical space and refuses insufficient headroom',()=>{
 const original=structuredClone(policy),budget=compensationBudget(policy,model,{enabled:true,known:true,extraTokens:100000});
 assert.deepEqual(policy,original);assert.equal(budget.details.targetWindow,400000);assert.equal(budget.details.runtimeWindow,500000);assert.equal(budget.compact,460000);
 assert.ok(Math.floor(budget.window*.9)>=budget.compact);assert.equal(budget.details.status,'active');
 const limited=compensationBudget(policy,{...model,max_context_window:450000},{enabled:true,known:true,extraTokens:100000});
 assert.equal(limited.details.status,'limited');assert.equal(limited.window,policy.window);
 const unknown=compensationBudget(policy,model,{enabled:true,known:false});assert.equal(unknown.details.status,'unavailable');assert.equal(unknown.compact,policy.compact);
 const off=compensationBudget(policy,model,{enabled:false});assert.equal(off.details.status,'off');assert.equal(off.window,policy.window);
});
test('interrupted turns retain reasoning and satisfy the next-turn history barrier',()=>{
 const events=[event('response_item',reasoning('prior',16000)),event('event_msg',{type:'task_complete',turn_id:'old'}),
  event('response_item',reasoning('interrupted',24000)),event('event_msg',{type:'turn_aborted',turn_id:'paused'})];
 assert.deepEqual(activeReasoningEstimate(events,{threadId:'chat',completedTurnId:'paused'}),{known:true,extraTokens:7176});
 assert.deepEqual(activeReasoningEstimate(events.slice(0,-1),{threadId:'chat',completedTurnId:'paused'}),{known:false,reason:'pending'});
 assert.equal(activeReasoningEstimate([...events,event('event_msg',{type:'turn_aborted',turn_id:'other'},'parent')],{threadId:'chat',completedTurnId:'paused'}).known,true);
});
test('readback confirmation recognizes reserved runtime space without changing target capacity',()=>{
 const budget=compensationBudget(policy,model,{enabled:true,known:true,extraTokens:100000});
 const chat={policy,modelMetadata:model,connected:true,freshUsage:true,phase:'confirmed',revision:1,observedWindow:500000,expectedWindow:500000,compensation:budget.details};
 assert.equal(windowConfirmed(chat),true);assert.equal(windowConfirmed({...chat,observedWindow:501000}),false);assert.equal(windowConfirmed({...chat,compensation:{...budget.details,status:'waiting'}}),false);
});
