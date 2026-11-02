import test from 'node:test';
import assert from 'node:assert/strict';
import {createTaskQueues,defaultQueueConfig} from '../src/task-queues.mjs';

function fixture(saved={}){
 let clock=1700000000000,serial=0,document=saved,ready=true;const protection={stopOnCreditsEnabled:false,creditsTrigger:"either"};
 const chat={id:'chat',model:'fixture',connected:true,status:'active',turnId:'source',inputEpoch:1,contextEpoch:0,policy:{revision:1,enabled:true},revision:1,phase:'confirmed'},calls=[],holds=[],deps=new Map();
 const quotaState={stale:false,accountScope:'account',updatedAt:clock,buckets:[{id:'codex',primary:{remainingPercent:80,windowDurationMins:300,resetsAt:clock/1000+3600},secondary:{remainingPercent:80,windowDurationMins:10080,resetsAt:clock/1000+86400}}]};
 const quota={state:()=>quotaState,refresh:async()=>{}};
 const engine=createTaskQueues({creditsConfig:()=>protection,load:()=>structuredClone(document),save:value=>{document=structuredClone(value);},thread:id=>id==='chat'?chat:null,quota,canDispatch:()=>ready,start:async(id,task)=>{calls.push(task);chat.status='active';chat.turnId='next';chat.automaticTask={executionId:task.executionId,status:'running',turnId:'next'};return chat.automaticTask;},interrupt:async()=>calls.push('interrupt'),operation:(_,id)=>deps.get(id),now:()=>clock,id:()=>String(++serial),inhibit:value=>holds.push(value)});
 return {engine,chat,calls,holds,quotaState,deps,protection,get document(){return document;},ready:v=>ready=v,advance:n=>{clock+=n;quotaState.updatedAt=clock;},schedule:(extra={})=>engine.schedule({id:'chat',prompt:'Continue original task from checkpoint.',requestId:'one-shot',...extra}),completeSource(){Object.assign(chat,{status:'idle',lastCompletedTurnId:'source',lastTurnStatus:'completed'});engine.observeThread(chat);}};
}
test('one-shot uses the existing scheduler without enabling regular queues or continuously monitoring afterward',async t=>{
 const f=fixture();t.after(()=>f.engine.close());f.engine.command({id:'chat',action:'add',prompt:'regular queued work'});
 const receipt=f.schedule();await f.engine.tick();assert.equal(f.calls.length,0);assert.equal(receipt.state,'waiting_for_turn');assert.equal(f.engine.get('chat').enabled,false);
 Object.assign(f.chat,{status:'idle'});f.engine.observeThread(f.chat);await f.engine.tick();assert.equal(f.calls.length,0,'idle alone is not source completion');
 f.completeSource();await new Promise(r=>setImmediate(r));await f.engine.tick();assert.equal(f.calls.length,1);assert.equal(f.calls[0].schedule.sourceTurnId,'source');assert.equal(f.engine.get('chat').tasks[0].status,'waiting');
 f.chat.status='idle';f.chat.automaticTask.status='completed';await f.engine.tick();assert.equal(f.engine.schedules()[0].state,'completed');assert.equal(f.engine.list().sleepPrevented,false);assert.equal(f.engine.get('chat').enabled,false);assert.equal(f.calls.length,1);
});
test('requests are deduplicated and pending work cancels on manual input, model/budget/history changes and source interruption',async t=>{
 for(const change of [{inputEpoch:2},{model:'other'},{policy:{revision:2}},{contextEpoch:1},{status:'idle',lastCompletedTurnId:'source',lastTurnStatus:'interrupted'}]){
  const f=fixture();t.after(()=>f.engine.close());const receipt=f.schedule();assert.equal(f.schedule().id,receipt.id);assert.throws(()=>f.schedule({prompt:'different'}),e=>e.code==='REQUEST_ID_CONFLICT');
  Object.assign(f.chat,change);f.engine.observeThread(f.chat);await f.engine.tick();assert.equal(f.engine.schedules()[0].state,'cancelled');assert.equal(f.calls.length,0);
 }
});
test('pause, disconnect, expiry and service restart never create a delayed surprise continuation',async t=>{
 for(const mode of ['pause','disconnect','expiry','restart']){
  const f=fixture();t.after(()=>f.engine.close());f.schedule();
  if(mode==='pause')f.engine.command({action:'monitoring',enabled:false});
  if(mode==='disconnect'){f.chat.connected=false;f.engine.observeThread(f.chat);}
  if(mode==='expiry')f.advance(16*60*1000);
  if(mode==='restart'){const next=fixture(f.document);t.after(()=>next.engine.close());assert.equal(next.engine.schedules()[0].state,'cancelled');await next.engine.tick();assert.equal(next.calls.length,0);continue;}
  await f.engine.tick();assert.ok(['cancelled','expired'].includes(f.engine.schedules()[0].state));assert.equal(f.calls.length,0);
 }
});
test('handoff waits for loaded budget, explicit dependency and fresh quota before exactly one start',async t=>{
 const f=fixture();t.after(()=>f.engine.close());f.deps.set('budget',{id:'budget',kind:'budget',state:'accepted'});f.schedule({afterOperation:'budget'});f.completeSource();
 f.chat.revision=0;await f.engine.tick();assert.equal(f.calls.length,0);
 f.deps.set('budget',{id:'budget',kind:'budget',state:'awaiting_readback'});await f.engine.tick();assert.equal(f.calls.length,0,'target must be loaded even if dependency advanced');
 f.chat.revision=1;f.quotaState.stale=true;await f.engine.tick();assert.equal(f.engine.schedules()[0].state,'waiting_quota');
 f.quotaState.stale=false;await f.engine.tick();assert.equal(f.calls.length,1);await f.engine.tick();assert.equal(f.calls.length,1);
});
test('uncertain submissions remain terminal across restart; waiting cancellation is scoped and does not run anything',async t=>{
 const f=fixture();t.after(()=>f.engine.close());const receipt=f.schedule();assert.throws(()=>f.engine.cancelSchedule('other',receipt.id),e=>e.code==='SCHEDULE_NOT_FOUND');assert.equal(f.engine.cancelSchedule('chat',receipt.id).state,'cancelled');f.completeSource();await f.engine.tick();assert.equal(f.calls.length,0);
 const g=fixture();t.after(()=>g.engine.close());g.schedule();g.completeSource();await new Promise(r=>setImmediate(r));await g.engine.tick();const restarted=fixture(g.document);t.after(()=>restarted.engine.close());assert.equal(restarted.engine.schedules()[0].state,'outcome_unknown');await restarted.engine.tick();assert.equal(restarted.calls.length,0);
});
test('global pause rejects registration and configured quota reserves protect the one-shot',async t=>{
 const f=fixture({monitoringEnabled:false});t.after(()=>f.engine.close());assert.throws(()=>f.schedule(),e=>e.code==='MONITORING_PAUSED');assert.equal(f.engine.schedules().length,0);
 const g=fixture();t.after(()=>g.engine.close());g.engine.command({id:'chat',action:'config',config:{...defaultQueueConfig(),fiveHour:{reserve:40,stages:[]}}});g.quotaState.buckets[0].primary.remainingPercent=30;g.schedule();g.completeSource();await g.engine.tick();assert.equal(g.calls.length,0);assert.equal(g.engine.schedules()[0].state,'waiting_quota');
});
test('save-only budgets and old compactions cannot authorize a handoff; its own completed compaction can',async t=>{
 const f=fixture();t.after(()=>f.engine.close());
 f.deps.set('saved',{id:'saved',kind:'budget',state:'completed',revision:1});assert.throws(()=>f.schedule({afterOperation:'saved'}),e=>e.code==='INVALID_DEPENDENCY');
 f.deps.set('old',{id:'old',kind:'compact',state:'completed',turnId:'previous',inputEpoch:0});assert.throws(()=>f.schedule({afterOperation:'old'}),e=>e.code==='INVALID_DEPENDENCY');assert.equal(f.engine.schedules().length,0);
 f.deps.set('compact',{id:'compact',kind:'compact',state:'waiting_for_idle',turnId:'source',inputEpoch:1});f.schedule({afterOperation:'compact'});f.completeSource();await f.engine.tick();assert.equal(f.calls.length,0);
 await new Promise(r=>setImmediate(r));f.deps.get('compact').state='completed';f.chat.phase='needs_observation';f.chat.appliedBudget={model:'fixture'};await f.engine.tick();assert.equal(f.calls.length,1);assert.equal(f.calls[0].schedule.compactionOperationId,'compact');
});

test('Credits handoffs start once and recheck the live Credits protection before further running',async t=>{
 const f=fixture();t.after(()=>f.engine.close());const b=f.quotaState.buckets[0];Object.assign(b,{hasCredits:true,creditBalance:'100'});Object.assign(b.primary,{usedPercent:0});Object.assign(b.secondary,{usedPercent:100,remainingPercent:0});
 f.schedule();f.completeSource();await new Promise(r=>setImmediate(r));await f.engine.tick();assert.equal(f.calls.length,1);assert.equal(f.engine.scheduleQuotaGate('chat').source,'credits');
 f.protection.stopOnCreditsEnabled=true;await f.engine.tick();assert.deepEqual(f.calls.slice(1),['interrupt']);await f.engine.tick();assert.equal(f.calls.length,2);
});
test('Credits availability changing while waiting is reevaluated without resubmission',async t=>{
 const f=fixture();t.after(()=>f.engine.close());const b=f.quotaState.buckets[0];Object.assign(b,{hasCredits:true,creditBalance:'0'});b.secondary.remainingPercent=0;
 f.schedule();f.completeSource();await new Promise(r=>setImmediate(r));await f.engine.tick();assert.equal(f.calls.length,0);assert.equal(f.engine.schedules()[0].state,'waiting_quota');
 b.creditBalance='100';await f.engine.tick();assert.equal(f.calls.length,1);await f.engine.tick();assert.equal(f.calls.length,1);
});
