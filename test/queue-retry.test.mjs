import test from 'node:test';
import assert from 'node:assert/strict';
import {createTaskQueues} from '../src/task-queues.mjs';
import {QUEUE_RETRY_MINUTES} from '../src/core/queue-retry.mjs';
const base=1800000000000;
function fixture(saved){
 let time=base,document=saved,sequence=0,calls=0,unknown=false,remaining=80;
 const thread={id:'chat',connected:true,status:'idle'};
 const engine=createTaskQueues({load:()=>document??{},save:value=>document=structuredClone(value),now:()=>time,id:()=>String(++sequence),thread:()=>thread,quota:{refresh:async()=>{},state:()=>({accountScope:'account-a',updatedAt:time,stale:false,buckets:[{id:'codex',primary:{remainingPercent:remaining,windowDurationMins:300,resetsAt:base/1000+18000}}]})},start:async()=>{calls++;if(unknown)throw Error('transport timeout');return {status:'error',error:'confirmed native failure',errorConfirmed:true};},interrupt:async()=>{}});
 const command=p=>engine.command({id:'chat',...p}),settle=async()=>{for(let i=0;i<4;i++)await new Promise(r=>setImmediate(r));};
 return {engine,command,settle,get calls(){return calls;},get saved(){return document;},at:minutes=>time=base+minutes*60000,set unknown(value){unknown=value;},set remaining(value){remaining=value;}};
}
test('retries use cumulative 1/3/5/10/15/30/45/60 minute deadlines and stop after eight attempts',async t=>{
 const f=fixture();t.after(()=>f.engine.close());f.command({action:'add',prompt:'first'});f.command({action:'add',prompt:'second'});f.command({action:'enable',enabled:true});await f.settle();assert.equal(f.calls,1);
 for(const [index,minute]of QUEUE_RETRY_MINUTES.entries()){f.at(minute-0.001);await f.engine.tick();assert.equal(f.calls,index+1);f.at(minute);await f.engine.tick();assert.equal(f.calls,index+2);assert.equal(f.engine.get('chat').tasks[0].retry.firstFailedAt,base);}
 f.at(62);await f.engine.tick();assert.equal(f.calls,9);assert.equal(f.engine.get('chat').tasks[0].retry,undefined);assert.match(f.engine.get('chat').message,/8 次/);assert.equal(f.engine.get('chat').tasks[1].status,'waiting');
});
test('restart retains the first failure and next absolute deadline without rearming the sequence',async t=>{
 const f=fixture();f.command({action:'add',prompt:'task'});f.command({action:'enable',enabled:true});await f.settle();f.at(1);await f.engine.tick();const saved=f.saved;f.engine.close();
 const restored=fixture(saved);t.after(()=>restored.engine.close());restored.at(2);await restored.engine.tick();assert.equal(restored.calls,0);restored.at(3);await restored.engine.tick();assert.equal(restored.calls,1);assert.equal(restored.engine.get('chat').tasks[0].retry.attempts,2);
});
test('uncertain submission cancels the retry plan instead of replaying work after a timeout',async t=>{
 const f=fixture();t.after(()=>f.engine.close());f.command({action:'add',prompt:'task'});f.command({action:'enable',enabled:true});await f.settle();f.unknown=true;f.at(1);await f.engine.tick();f.at(60);await f.engine.tick();assert.equal(f.calls,2);assert.equal(f.engine.get('chat').tasks[0].retry,undefined);assert.equal(f.engine.get('chat').pause.kind,'manual');
});
test('quota-paused attempts check the reserve and never submit a prompt below it',async t=>{
 const f=fixture();t.after(()=>f.engine.close());f.remaining=0;f.command({action:'add',prompt:'task'});f.command({action:'enable',enabled:true});await f.settle();
 for(const minute of QUEUE_RETRY_MINUTES){f.at(minute);await f.engine.tick();}assert.equal(f.calls,0);f.at(62);await f.engine.tick();assert.match(f.engine.get('chat').tasks[0].error,/8 次/);
});
test('manual pause prevents retry and waking late performs one check rather than a burst',async t=>{
 const f=fixture();t.after(()=>f.engine.close());f.command({action:'add',prompt:'task'});f.command({action:'enable',enabled:true});await f.settle();f.command({action:'monitoring',enabled:false});f.at(10);await f.engine.tick();assert.equal(f.calls,1);
 f.command({action:'monitoring',enabled:true});await f.settle();assert.equal(f.calls,2);assert.equal(f.engine.get('chat').tasks[0].retry.attempts,4);assert.equal(f.engine.get('chat').tasks[0].retry.nextAt,base+15*60000);
});
