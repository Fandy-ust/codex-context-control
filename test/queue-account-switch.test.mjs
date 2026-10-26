import test from 'node:test';
import assert from 'node:assert/strict';
import {createQueueAccountSwitch,accountSwitchDemand} from '../src/queue-account-switch.mjs';
import {defaultQueueConfig} from '../src/core/queue-config.mjs';

function fixture(saved={}){
  let time=1800000000000,active='a',document,held=0,blocked=false,wrong=false,inspectHook,swapHook,openFailure=false;
  const calls=[],config=defaultQueueConfig(),queue={id:'chat',enabled:true,pause:{kind:'quota',scope:'scope-a',windows:[]},config,tasks:[{id:'task',status:'waiting',prompt:'Do this exactly once',settings:{quota:config}}]};
  const state={monitoringEnabled:true,queues:[queue]},limits={a:10,b:80,c:90};
  const quota=id=>({accountScope:'scope-'+id,updatedAt:time,stale:false,buckets:[{id:'codex',primary:{windowDurationMins:300,remainingPercent:limits[id],resetsAt:time/1000+3600},secondary:{windowDurationMins:10080,remainingPercent:80,resetsAt:time/1000+86400}}]});
  const current=()=>({id:wrong?'a':active,quota:quota(wrong?'a':active)});
  const manager=createQueueAccountSwitch({load:()=>saved,save:value=>document=structuredClone(value),now:()=>time,queues:{list:()=>state,suspend:async()=>{held++;return ()=>held--; }},current,profiles:()=>[{id:'a'},{id:'b'},{id:'c'}],
    ready:async()=>{if(blocked)throw Error('another chat is active');},inspect:async id=>{calls.push('inspect:'+id);await inspectHook?.(id);return quota(id);},
    switchAccount:async(id,context)=>{assert.equal(held,1);assert.equal(manager.dispatchAllowed(),false);assert.equal(document.pending.target,id);assert.equal(context.authorized(),true);calls.push('switch:'+id);context.runtimeClosed=true;await swapHook?.(context);active=id;context.committed=true;},
    refreshCurrent:async()=>{calls.push('verify');return current();},openDesktop:async()=>{calls.push('open');if(openFailure)throw Error('open failed');}});
  return {manager,queue,state,limits,calls,current,get saved(){return document;},get held(){return held;},advance:ms=>time+=ms,set blocked(value){blocked=value;},set wrong(value){wrong=value;},set inspectHook(value){inspectHook=value;},set swapHook(value){swapHook=value;},set openFailure(value){openFailure=value;}};
}

test('automatic account switching defaults off and never checks credentials without opt-in',async()=>{
 const f=fixture();await f.manager.tick();assert.deepEqual(f.calls,[]);assert.equal(f.manager.state().enabled,false);assert.equal(f.manager.dispatchAllowed(),true);
});

test('fresh candidate quota, durable handoff and identity confirmation precede resuming dispatch',async()=>{
 const f=fixture();f.manager.configure(true);await f.manager.tick();
 assert.deepEqual(f.calls,['inspect:b','switch:b','open','verify']);assert.equal(f.saved.pending,null);assert.equal(f.manager.dispatchAllowed(),true);assert.equal(f.held,0);assert.equal(f.queue.tasks[0].status,'waiting');assert.equal(f.queue.tasks[0].prompt,'Do this exactly once');
 await f.manager.tick();assert.equal(f.calls.filter(c=>c.startsWith('switch:')).length,1);
});

test('exhausted candidate is skipped; no available account preserves the queue and avoids switch loops',async()=>{
 const f=fixture();f.limits.b=10;f.manager.configure(true);await f.manager.tick();assert.ok(f.calls.includes('switch:c'));assert.equal(f.calls.includes('switch:b'),false);
 const none=fixture();none.limits.b=0;none.limits.c=0;none.manager.configure(true);await none.manager.tick();await none.manager.tick();assert.deepEqual(none.calls,['inspect:b','inspect:c']);assert.equal(none.manager.dispatchAllowed(),true);assert.equal(none.queue.tasks[0].status,'waiting');
});

test('other active work, manual queue pauses and global monitoring pause prohibit automatic switching',async()=>{
 const f=fixture();f.manager.configure(true);f.blocked=true;await f.manager.tick();assert.deepEqual(f.calls,[]);assert.equal(f.held,0);
 f.blocked=false;f.advance(31000);f.queue.pause={kind:'manual'};await f.manager.tick();assert.deepEqual(f.calls,[]);
 f.queue.pause={kind:'quota'};f.state.monitoringEnabled=false;await f.manager.tick();assert.deepEqual(f.calls,[]);
});

test('turning the feature or queue off during candidate inspection never closes a runtime',async()=>{
 for(const change of ['feature','queue']){const f=fixture();f.manager.configure(true);f.inspectHook=()=>{if(change==='feature')f.manager.configure(false);else f.queue.enabled=false;};await f.manager.tick();assert.equal(f.calls.some(c=>c.startsWith('switch:')),false);assert.equal(f.held,0);}
});

test('wrong or stale post-switch identity keeps dispatch blocked across service restarts',async()=>{
 const f=fixture();f.manager.configure(true);f.wrong=true;await f.manager.tick();assert.equal(f.manager.dispatchAllowed(),false);assert.equal(f.saved.pending.target,'b');assert.equal(f.held,0);
 const restart=fixture(f.saved);restart.manager.configure(false);await restart.manager.tick();assert.equal(restart.manager.dispatchAllowed(),false,'disabling automation does not accept the wrong account');
 f.wrong=false;f.advance(31000);await f.manager.tick();assert.equal(f.manager.dispatchAllowed(),true);assert.equal(f.saved.pending,null);
});

test('switch failure keeps the original task and reopens a runtime only when it was closed',async()=>{
 const f=fixture();f.manager.configure(true);f.swapHook=()=>{throw Error('auth rejected');};await f.manager.tick();assert.equal(f.saved.pending,null);assert.equal(f.queue.tasks[0].status,'waiting');assert.equal(f.manager.dispatchAllowed(),true);assert.equal(f.calls.filter(c=>c==='open').length,1);
});

test('manual resume preferences, completed queues and unknown identity never rotate accounts',()=>{
 const f=fixture();f.queue.config.resume='manual';assert.equal(accountSwitchDemand(f.state,f.current()),null);f.queue.config.resume='auto';f.queue.tasks[0].status='completed';assert.equal(accountSwitchDemand(f.state,f.current()),null);f.queue.tasks[0].status='waiting';assert.equal(accountSwitchDemand(f.state,{...f.current(),id:null}),null);
});
