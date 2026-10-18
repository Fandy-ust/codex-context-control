import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createTaskQueues,defaultQueueConfig,queueQuotaGate,validateQueueConfig,effectiveReserve} from '../src/task-queues.mjs';
import {Bridge} from '../src/bridge.mjs';

function fixture(saved){
 let clock=1700000000000,serial=0,document=saved??{},blocked=false;
 const chat={id:'chat',connected:true,status:'idle'},calls=[],sleep=[];
 const bucket={id:'codex',primary:{remainingPercent:80,windowDurationMins:300,resetsAt:clock/1000+3600},secondary:{remainingPercent:80,windowDurationMins:10080,resetsAt:clock/1000+86400}};
 const quota={state:()=>({buckets:[bucket],updatedAt:clock,stale:blocked}),refresh:async()=>{}};
 const engine=createTaskQueues({load:()=>structuredClone(document),save:d=>{document=structuredClone(d);},quota,thread:()=>chat,now:()=>clock,id:()=>String(++serial),inhibit:value=>sleep.push(value),start:async(id,t)=>{calls.push(t);chat.status='active';chat.automaticTask={executionId:t.executionId,status:'running'};},interrupt:async()=>calls.push('interrupt')});
 const command=p=>engine.command({id:'chat',...p});
 const settle=async()=>{for(let n=0;n<5;n++)await new Promise(r=>setImmediate(r));};
 return {engine,command,chat,bucket,calls,sleep,settle,get document(){return document;},advance:n=>clock+=n,stale:v=>blocked=v,done(status='completed'){chat.status='idle';chat.automaticTask.status=status;}};
}
test('guard supports two ordered release stages, returns to base after reset, and never uses expired quota',()=>{
 const c=defaultQueueConfig();c.fiveHour.stages=[{minutes:30,reserve:10},{minutes:15,reserve:3}];validateQueueConfig(c);
 assert.equal(effectiveReserve(c.fiveHour,{resetsAt:3600},0),20);assert.equal(effectiveReserve(c.fiveHour,{resetsAt:1200},0),10);assert.equal(effectiveReserve(c.fiveHour,{resetsAt:600},0),3);assert.equal(effectiveReserve(c.fiveHour,{resetsAt:0},0),20);
 assert.throws(()=>validateQueueConfig({...c,fiveHour:{reserve:20,stages:[{minutes:15,reserve:3},{minutes:30,reserve:10}]}}));
 assert.throws(()=>validateQueueConfig({...c,weekly:{reserve:NaN,stages:[]}}));
 assert.equal(queueQuotaGate(c,{buckets:[]},100).valid,false);
});
test('queues default off, sequentially submit full prompts and turn off and release sleep after completion',async t=>{
 const f=fixture();t.after(()=>f.engine.close());f.command({action:'add',prompt:'完整任务一\n包含验收条件'});f.command({action:'add',prompt:'完整任务二'});await f.settle();assert.equal(f.calls.length,0);assert.equal(f.engine.list().sleepPrevented,false);
 f.command({action:'enable',enabled:true});await f.settle();assert.equal(f.calls[0].prompt,'完整任务一\n包含验收条件');await f.engine.tick();assert.equal(f.calls.length,1);
 f.done();await f.engine.tick();assert.equal(f.calls[1].prompt,'完整任务二');f.done();await f.engine.tick();assert.equal(f.engine.get('chat').enabled,false);assert.equal(f.engine.list().sleepPrevented,false);assert.deepEqual(f.sleep,[true,false]);
});
test('soft threshold finishes current turn; hard threshold interrupts exact queue execution; fresh reset resumes',async t=>{
 const f=fixture();t.after(()=>f.engine.close());f.command({action:'add',prompt:'任务'});f.command({action:'enable',enabled:true});await f.settle();f.bucket.primary.remainingPercent=20;await f.engine.tick();assert.equal(f.calls.length,1);
 f.bucket.primary.remainingPercent=18;await f.engine.tick();assert.equal(f.calls[1],'interrupt');await f.engine.tick();assert.equal(f.calls.length,2);
 f.done('interrupted');await f.engine.tick();assert.equal(f.engine.get('chat').state,'paused');f.bucket.primary.remainingPercent=90;await f.engine.tick();assert.equal(f.calls.length,2,'a higher percentage alone is not proof of reset');f.bucket.primary.resetsAt+=18000;await f.engine.tick();assert.match(f.calls[2].prompt,/继续上次/);
});
test('Weekly independently blocks starts, and stale quota cannot start queued tasks',async t=>{
 const f=fixture();t.after(()=>f.engine.close());f.bucket.secondary.remainingPercent=10;f.command({action:'add',prompt:'任务'});f.command({action:'enable',enabled:true});await f.settle();assert.equal(f.calls.length,0);f.bucket.secondary.resetsAt+=604800;f.bucket.secondary.remainingPercent=100;f.stale(true);await f.engine.tick();assert.equal(f.calls.length,0);f.stale(false);await f.engine.tick();assert.equal(f.calls.length,1);
});
test('manual resume and pause current cycle are distinct; later cycles retain the configured policy',async t=>{
 const f=fixture();t.after(()=>f.engine.close());f.command({action:'config',config:{...defaultQueueConfig(),resume:'manual'}});f.command({action:'add',prompt:'任务'});f.bucket.primary.remainingPercent=20;f.command({action:'enable',enabled:true});await f.settle();f.bucket.primary.resetsAt+=18000;f.bucket.primary.remainingPercent=100;await f.engine.tick();assert.equal(f.calls.length,0);f.command({action:'enable',enabled:true});await f.settle();assert.equal(f.calls.length,1);
});
test('explicit enable adopts the current turn at the head, then runs subsequent prompt tasks',async t=>{
 const f=fixture();t.after(()=>f.engine.close());f.chat.status='active';f.chat.turnId='manual-turn';f.command({action:'add',prompt:'下一项完整任务'});f.command({action:'enable',enabled:true});await f.settle();assert.equal(f.calls[0].adoptTurnId,'manual-turn');assert.equal(f.engine.get('chat').tasks[0].kind,'current');f.done();await f.engine.tick();assert.equal(f.calls[1].prompt,'下一项完整任务');
});
test('unmonitored manual turns are never interrupted; global off stops observation and sleep assertion',async t=>{
 const f=fixture();t.after(()=>f.engine.close());f.chat.status='active';f.chat.turnId='manual';f.bucket.primary.remainingPercent=0;f.command({action:'add',prompt:'任务'});await f.engine.tick();assert.equal(f.calls.length,0);f.command({action:'enable',enabled:true});await f.settle();f.command({action:'disable-all'});assert.equal(f.engine.list().sleepPrevented,false);assert.equal(f.engine.get('chat').enabled,false);
});
test('restart keeps prompts and order but disables uncertain running work to prevent duplicate submission',async t=>{
 const f=fixture();t.after(()=>f.engine.close());f.command({action:'add',prompt:'持久化任务'});f.command({action:'enable',enabled:true});await f.settle();const restored=fixture(f.document);t.after(()=>restored.engine.close());await restored.engine.tick();assert.equal(restored.calls.length,0);assert.equal(restored.engine.get('chat').enabled,false);assert.equal(restored.engine.get('chat').tasks[0].status,'interrupted');
});
test('queue CRUD and reorder are validated, including stale revisions and active-task edits',async t=>{
 const f=fixture();t.after(()=>f.engine.close());f.command({action:'add',prompt:'一'});f.command({action:'add',prompt:'二'});const ids=f.engine.get('chat').tasks.map(t=>t.id);f.command({action:'reorder',order:[...ids].reverse()});assert.equal(f.engine.get('chat').tasks[0].prompt,'二');assert.throws(()=>f.command({action:'reorder',order:[ids[0],ids[0]]}));assert.throws(()=>f.command({action:'edit',taskId:ids[0],prompt:'修改',expectedRevision:0}));f.command({action:'edit',taskId:ids[0],prompt:'修改'});f.command({action:'delete',taskId:ids[1]});f.command({action:'enable',enabled:true});await f.settle();assert.throws(()=>f.command({action:'edit',taskId:ids[0],prompt:'危险修改'}));
});
test('burn-down automatically unlocks a quota-paused queue before reset, then protects the new reserve',async t=>{
 const f=fixture();t.after(()=>f.engine.close());const config=defaultQueueConfig();config.fiveHour.stages=[{minutes:30,reserve:10},{minutes:15,reserve:3}];f.command({action:'config',config});f.command({action:'add',prompt:'释放剩余额度'});f.bucket.primary.remainingPercent=20;f.command({action:'enable',enabled:true});await f.settle();assert.equal(f.calls.length,0);f.advance(31*60000);await f.engine.tick();assert.equal(f.calls.length,1);f.bucket.primary.remainingPercent=8;await f.engine.tick();assert.equal(f.calls[1],'interrupt');
});
test('manual interruption never silently retries a task or skips to the next prompt',async t=>{
 const f=fixture();t.after(()=>f.engine.close());f.command({action:'add',prompt:'一'});f.command({action:'add',prompt:'二'});f.command({action:'enable',enabled:true});await f.settle();f.done('interrupted');await f.engine.tick();assert.equal(f.calls.length,1);assert.equal(f.engine.get('chat').state,'paused');f.command({action:'enable',enabled:true});await f.settle();assert.match(f.calls[1].prompt,/继续上次/);assert.match(f.calls[1].prompt,/一/);
});
test('lost runtime ownership disables uncertain work instead of hanging or interrupting another turn',async t=>{
 const f=fixture();t.after(()=>f.engine.close());f.command({action:'add',prompt:'任务'});f.command({action:'enable',enabled:true});await f.settle();delete f.chat.automaticTask;await f.engine.tick();assert.equal(f.engine.get('chat').enabled,false);assert.equal(f.engine.get('chat').tasks[0].status,'interrupted');assert.equal(f.engine.list().sleepPrevented,false);
});
test('cycle pause expires once and does not turn the future resume policy into manual',async t=>{
 const f=fixture();t.after(()=>f.engine.close());f.command({action:'add',prompt:'任务'});f.command({action:'add',prompt:'下个任务'});f.command({action:'enable',enabled:true});await f.settle();f.command({action:'pause-cycle'});const until=f.engine.get('chat').pause.until;f.done();await f.engine.tick();assert.equal(f.calls.length,1);f.advance(until-1700000000000+1000);f.bucket.primary.resetsAt+=18000;await f.engine.tick();assert.equal(f.calls.length,2);assert.equal(f.engine.get('chat').config.resume,'auto');
});
test('bridge preserves settings, deduplicates queue delivery, and refuses to interrupt a different manual turn',async t=>{
 const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();const input=new PassThrough(),output=new PassThrough(),b=new Bridge(child,input,output);t.after(()=>{b.frontLines.close();b.backLines.close();input.destroy();output.destroy();child.stdin.destroy();child.stdout.destroy();});
 const r=b.record('chat');r.sticky={model:'fixture',effort:'high',approvalPolicy:'on-request'};const calls=[];b.rpc=async(method,params)=>{calls.push({method,params});return {turn:{id:'automatic-turn',status:'inProgress'}};};
 const task={executionId:'one',taskId:'a',prompt:'完整的多行\n任务提示词'};await b.startAutomatic('chat',task);await b.startAutomatic('chat',task);assert.equal(calls.length,1);assert.equal(calls[0].params.effort,'high');assert.equal(calls[0].params.input[0].text,task.prompt);
 await b.interruptAutomatic('chat','one');assert.equal(calls[1].params.turnId,'automatic-turn');r.turnId='new-manual-turn';await assert.rejects(b.interruptAutomatic('chat','one'),/未中断其他任务/);
});
