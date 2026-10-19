import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createTaskQueues,defaultQueueConfig,queueQuotaGate,validateQueueConfig,effectiveReserve} from '../src/task-queues.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {normalizeTaskSettings} from '../src/core/task-settings.mjs';
import {supportsTaskQueues} from '../src/core/queue-runtime.mjs';
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


test('three release stages are validated and the closest stage restores to base after reset',()=>{
 const c=defaultQueueConfig();c.fiveHour.stages=[{minutes:30,reserve:10},{minutes:15,reserve:3},{minutes:5,reserve:1}];validateQueueConfig(c);
 assert.equal(effectiveReserve(c.fiveHour,{resetsAt:240},0),1);assert.equal(effectiveReserve(c.fiveHour,{resetsAt:0},0),20);
 assert.throws(()=>validateQueueConfig({...c,fiveHour:{...c.fiveHour,stages:[...c.fiveHour.stages,{minutes:1,reserve:0}]}}),/三个/);
});

test('each task snapshots defaults and the next task uses its own guard on the same completion tick',async t=>{
 const f=fixture();t.after(()=>f.engine.close());const high=defaultQueueConfig();high.fiveHour.reserve=70;
 f.command({action:'add',prompt:'先完成低保留任务'});f.command({action:'config',config:high});f.command({action:'add',prompt:'高保留任务'});
 const tasks=f.engine.get('chat').tasks;assert.equal(tasks[0].settings.quota.fiveHour.reserve,20);assert.equal(tasks[1].settings.quota.fiveHour.reserve,70);
 f.bucket.primary.remainingPercent=50;f.command({action:'enable',enabled:true});await f.settle();assert.equal(f.calls.length,1);
 f.done();await f.engine.tick();assert.equal(f.calls.length,1,'next task must not inherit the completed task guard');
 assert.equal(f.engine.get('chat').state,'paused');
});

test('running task quota can be edited without changing its prompt or later task defaults',async t=>{
 const f=fixture();t.after(()=>f.engine.close());f.command({action:'add',prompt:'任务'});f.command({action:'enable',enabled:true});await f.settle();
 const task=f.engine.get('chat').tasks[0],config=defaultQueueConfig();config.fiveHour.reserve=60;
 f.command({action:'task-config',taskId:task.id,config});f.bucket.primary.remainingPercent=58;await f.engine.tick();
 assert.equal(f.calls.at(-1),'interrupt');assert.equal(f.engine.get('chat').config.fiveHour.reserve,20);assert.equal(f.engine.get('chat').tasks[0].prompt,'任务');
});

test('old bridges are rejected before submission and failed tasks cannot be skipped silently',async t=>{
 assert.equal(supportsTaskQueues({version:'0.19.20'}),false);assert.equal(supportsTaskQueues({version:'0.22.1',taskQueueVersion:2}),false);assert.equal(supportsTaskQueues({version:'0.22.1'}),false);assert.equal(supportsTaskQueues({version:'0.22.4'}),true);assert.equal(supportsTaskQueues({version:'0.22.0',taskQueueVersion:1}),false);assert.equal(supportsTaskQueues({version:'0.22.4',taskQueueVersion:4}),true);
 const f=fixture();t.after(()=>f.engine.close());f.chat.taskQueueSupported=false;f.command({action:'add',prompt:'任务'});
 assert.throws(()=>f.command({action:'enable',enabled:true}),/重新打开 Codex/);assert.equal(f.calls.length,0);assert.equal(f.engine.list().sleepPrevented,false);
 f.chat.taskQueueSupported=true;f.command({action:'add',prompt:'下一项'});f.command({action:'enable',enabled:true});await f.settle();f.done('error');await f.engine.tick();
 assert.equal(f.calls.length,1);assert.equal(f.engine.get('chat').enabled,false);assert.equal(f.engine.list().sleepPrevented,false);
});

test('unopened chats load in the background and wait for idle without needing frontend navigation',async t=>{
 const f=fixture();t.after(()=>f.engine.close());f.chat.connected=false;f.chat.queueCanLoad=true;let prepared=0,starts=0;
 const engine=createTaskQueues({quota:{state:()=>({updatedAt:1700000000000,buckets:[f.bucket]}),refresh:async()=>{}},thread:()=>f.chat,now:()=>1700000000000,prepare:async()=>{prepared++;f.chat.connected=true;f.chat.status='active';},start:async()=>{starts++;},interrupt:async()=>{}});t.after(()=>engine.close());
 engine.command({id:'chat',action:'add',prompt:'无需点击窗口'});engine.command({id:'chat',action:'enable',enabled:true});await f.settle();await engine.tick();assert.equal(prepared,1);assert.equal(starts,0);
 f.chat.status='idle';await engine.tick();assert.equal(starts,1);
});

function bridgeFixture(t,resolve=async()=>null){
 const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();const input=new PassThrough(),output=new PassThrough(),b=new Bridge(child,input,output,async()=>({}),resolve);
 t.after(()=>{b.frontLines.close();b.backLines.close();for(const stream of [input,output,child.stdin,child.stdout])stream.destroy();});return b;
}

test('background resume preserves thread settings, policy and an existing active turn',async t=>{
 const policy={enabled:true,revision:4,window:400000,compact:360000};const b=bridgeFixture(t,async()=>({policy})),calls=[];
 b.rpc=async(method,params)=>{calls.push({method,params});return {thread:{id:'unopened',cwd:'/fixture',status:{type:'active'},turns:[{id:'current-turn',status:'inProgress'}]},model:'fixture',approvalPolicy:'on-request',permissions:{profile:'fixture'}};};
 await b.prepareAutomatic('unopened');await b.prepareAutomatic('unopened');
 assert.equal(calls.length,1);assert.equal(calls[0].method,'thread/resume');assert.equal(calls[0].params.config.model_context_window,400000);
 const r=b.records.get('unopened');assert.equal(r.status,'active');assert.equal(r.turnId,'current-turn');assert.equal(r.seed.cwd,'/fixture');assert.deepEqual(r.seed.permissions,{profile:'fixture'});assert.equal(r.appliedRevision,4);
 await assert.rejects(b.startAutomatic('unopened',{prompt:'must wait',executionId:'no'}),/空闲/);
});

test('task model and effort are validated against runtime capabilities and attachments use native image input',async t=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'queue-files-'));t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
 const image=path.join(temp,'image.png'),file=path.join(temp,'notes.txt');fs.writeFileSync(image,'fixture');fs.writeFileSync(file,'notes');
 const b=bridgeFixture(t),r=b.record('chat');r.model='old';r.sticky={approvalPolicy:'on-request',collaborationMode:{mode:'default',settings:{model:'old',reasoning_effort:'low'}}};const calls=[];
 b.rpc=async(method,params)=>{calls.push({method,params});return method==='model/list'?{data:[{model:'new',supportedReasoningEfforts:[{reasoningEffort:'high'}],defaultReasoningEffort:'high',inputModalities:['text','image']}]}:{turn:{id:'turn',status:'inProgress'}};};
 const settings=normalizeTaskSettings({model:'new',effort:'high',attachments:[{kind:'image',path:image},{kind:'file',path:file}]});
 await b.startAutomatic('chat',{taskId:'t',executionId:'x',prompt:'读取附件',settings});const params=calls.find(c=>c.method==='turn/start').params;
 assert.equal(params.model,'new');assert.equal(params.effort,'high');assert.equal(params.approvalPolicy,'on-request');assert.equal(params.collaborationMode.settings.model,'new');assert.deepEqual(params.input[1],{type:'localImage',path:image});assert.ok(params.input[0].text.includes(JSON.stringify(file)));
 r.status='idle';await assert.rejects(b.startAutomatic('chat',{executionId:'bad',prompt:'任务',settings:{...settings,effort:'ultra'}}),/不支持此思考程度/);
 assert.equal(calls.filter(c=>c.method==='turn/start').length,1);
 assert.throws(()=>normalizeTaskSettings({attachments:[{kind:'file',path:'relative.txt'}]}),/路径/);
});


test('accounts without a 5h window guard against available Weekly quota without waiting for 5h',async t=>{
 const f=fixture();t.after(()=>f.engine.close());delete f.bucket.primary;f.command({action:'add',prompt:'Weekly-only 任务'});f.command({action:'enable',enabled:true});await f.settle();assert.equal(f.calls.length,1);
 f.bucket.secondary.remainingPercent=8;await f.engine.tick();assert.equal(f.calls.at(-1),'interrupt');
 const gate=queueQuotaGate(defaultQueueConfig(),{buckets:[f.bucket],updatedAt:1700000000000},1700000000000);assert.equal(gate.valid,true);assert.equal(gate.windows.length,1);assert.equal(gate.windows[0].name,'weekly');
 assert.equal(queueQuotaGate(defaultQueueConfig(),{buckets:[{id:'codex'}],updatedAt:1700000000000},1700000000000).valid,false);
});


test('queue compact command uses native compaction and completes only after its completion notification',async t=>{
 const b=bridgeFixture(t),r=b.record('chat'),calls=[];b.rpc=async(method,params)=>{calls.push({method,params});return {};};
 await b.startAutomatic('chat',{taskId:'compact',executionId:'compact-execution',prompt:'/compact'});
 assert.equal(calls[0].method,'thread/compact/start');assert.equal(r.automaticTask.status,'running');assert.equal(r.locked,true);
 b.fromServer(JSON.stringify({method:'turn/completed',params:{threadId:'chat',turn:{id:'compact-turn',status:'completed'}}}));
 for(let n=0;n<3;n++)await new Promise(resolve=>setImmediate(resolve));assert.equal(r.automaticTask.status,'completed');assert.equal(r.locked,false);assert.equal(calls.some(c=>c.method==='turn/start'),false);
});

test('unsupported slash commands and mixed compact instructions are rejected before saving',t=>{
 const f=fixture();t.after(()=>f.engine.close());assert.throws(()=>f.command({action:'add',prompt:'/unknown'}),/暂不支持/);assert.throws(()=>f.command({action:'add',prompt:'/compact then do something'}),/单独/);assert.equal(f.engine.list().queues.length,0);
 f.command({action:'add',prompt:'/compact'});assert.equal(f.engine.get('chat').tasks[0].prompt,'/compact');
});


test('failed native compaction marks the queue task failed rather than advancing it',async t=>{
 const b=bridgeFixture(t),r=b.record('chat');b.rpc=async()=>({});await b.startAutomatic('chat',{taskId:'compact',executionId:'failed-compact',prompt:'/compact'});
 b.fromServer(JSON.stringify({method:'turn/completed',params:{threadId:'chat',turn:{id:'compact-turn',status:'failed'}}}));
 for(let n=0;n<3;n++)await new Promise(resolve=>setImmediate(resolve));assert.equal(r.automaticTask.status,'error');assert.equal(r.phase,'error');assert.equal(r.locked,false);
});

test('per-task permission choices map to native approval fields, inherit by default, and reject unknown modes',async t=>{
 assert.equal(normalizeTaskSettings().approval,'inherit');assert.throws(()=>normalizeTaskSettings({approval:'invalid'}));
 const b=bridgeFixture(t),r=b.record('chat'),calls=[];
 b.rpc=async(method,params)=>{calls.push({method,params});return {turn:{id:'permission-turn-'+calls.length,status:'completed'}};};
 for(const mode of ['inherit','ask','auto','full']){
   r.sticky={approvalPolicy:'untrusted',approvalsReviewer:'user',permissions:'fixture-profile'};r.seed={};r.status='idle';
   await b.startAutomatic('chat',{taskId:mode,executionId:mode,prompt:'权限设置测试',settings:{approval:mode}});
   const p=calls.at(-1).params;
   if(mode==='inherit'){assert.equal(p.permissions,'fixture-profile');assert.equal(p.approvalPolicy,'untrusted');assert.equal(p.sandboxPolicy,undefined);}
   else{assert.equal(p.permissions,null);assert.equal(p.approvalPolicy,mode==='full'?'never':'on-request');assert.equal(p.approvalsReviewer,mode==='auto'?'auto_review':'user');assert.equal(p.sandboxPolicy.type,mode==='full'?'dangerFullAccess':'workspaceWrite');}
 }
});

test('saving an identical configured budget advances its revision without requiring another usage record',async t=>{
 const b=bridgeFixture(t),r=b.record('chat');r.appliedRevision=5;r.configuredWindow=700000;r.seed={config:{model_context_window:700000,model_auto_compact_token_limit:640000}};r.usageFresh=false;
 const result=b.setPolicy('chat',{revision:9,window:700000,compact:640000,reserve:16000,retainedFloor:0},null);
 assert.equal(result.queued,false);assert.equal(r.appliedRevision,9);
 const calls=[];b.rpc=async(method)=>{calls.push(method);return {turn:{id:'budget-turn',status:'completed'}};};
 await b.startAutomatic('chat',{taskId:'a',executionId:'budget-current',prompt:'继续任务'});assert.deepEqual(calls,['turn/start']);
});
test('automatic turns can produce the missing usage observation but cannot bypass an unsafe budget preflight',async t=>{
 const b=bridgeFixture(t),r=b.record('chat'),calls=[];
 r.policy={revision:2,window:700000,compact:640000,reserve:16000,retainedFloor:0};r.appliedRevision=1;r.usageFresh=false;r.modelInfo={max_context_window:828000,effective_context_window_percent:100};
 b.rpc=async(method)=>{calls.push(method);return {turn:{id:'observation-turn',status:'completed'}};};
 await b.startAutomatic('chat',{taskId:'a',executionId:'observe',prompt:'运行任务并取得实际用量'});assert.deepEqual(calls,['turn/start']);assert.equal(r.appliedRevision,1);
 r.status='idle';r.modelInfo={max_context_window:828000,effective_context_window_percent:100};r.policy={...r.policy,window:900000,revision:3};
 await assert.rejects(b.startAutomatic('chat',{taskId:'b',executionId:'unsafe',prompt:'不能绕过上限'}),/目录上限/);assert.equal(calls.length,1);
});
