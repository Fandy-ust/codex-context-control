import test from 'node:test';
import assert from 'node:assert/strict';
import {observeQuotaResets,resetNotificationText} from '../src/core/quota-reset-notifications.mjs';
import {createResetNotifier} from '../desktop/quota-reset-notifications.mjs';
import {createQuotaManager} from '../src/account-quota.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const base=1800000000000;
const reading=(at,fiveReset=base/1000+5,weeklyReset=base/1000+5,five=80,weekly=90,scope='a')=>({scope,at,buckets:[{id:'codex',primary:{windowDurationMins:300,resetsAt:fiveReset,usedPercent:five},secondary:{windowDurationMins:10080,resetsAt:weeklyReset,usedPercent:weekly}}]});
test('first observation and expired countdown alone never announce a reset',()=>{
 const s=observeQuotaResets(null,reading(base));assert.equal(s.event,null);
 assert.equal(observeQuotaResets(s,reading(base+10000)).event,null);
});
test('five-hour and weekly reset together produce one combined event',()=>{
 const s=observeQuotaResets(null,reading(base));
 const next=observeQuotaResets(s,reading(base+10000,base/1000+18000,base/1000+604800,0,0));
 assert.deepEqual(next.event.roles,['five','weekly']);assert.equal(next.event.deliverAfter,base+30000);
 assert.match(resetNotificationText(next.event.roles)[0],/都已重置/);
 assert.equal(observeQuotaResets(next,reading(base+20000,base/1000+18000,base/1000+604800,0,0)).event.id,next.event.id);
});
test('adjacent polls combine resets, but a later reset gets its own event',()=>{
 const s=observeQuotaResets(null,reading(base));
 const first=observeQuotaResets(s,reading(base+10000,base/1000+18000,base/1000+5,0,90));
 assert.deepEqual(first.event.roles,['five']);
 const second=observeQuotaResets(first,reading(base+20000,base/1000+18000,base/1000+604800,0,0));
 assert.equal(first.event.id,second.event.id);assert.deepEqual(second.event.roles,['five','weekly']);
 const later=observeQuotaResets(first,reading(base+40000,base/1000+18000,base/1000+604800,0,0));
 assert.notEqual(later.event.id,first.event.id);assert.deepEqual(later.event.roles,['weekly']);
});
test('manual reset is detected even while the old reset timestamp is retained',()=>{
 const s=observeQuotaResets(null,reading(base));const next=observeQuotaResets(s,reading(base+1000,base/1000+5,base/1000+5,0,90));assert.deepEqual(next.event.roles,['five']);
 const activated=observeQuotaResets(next,reading(base+10000,base/1000+18000,base/1000+5,1,90));assert.equal(activated.event.id,next.event.id);
});
test('account changes, missing windows and old history do not create false resets',()=>{
 const s=observeQuotaResets(null,reading(base));
 assert.equal(observeQuotaResets(s,reading(base+10000,base/1000+18000,base/1000+604800,0,0,'b')).event,null);
 assert.equal(observeQuotaResets(s,reading(base+25*3600000,base/1000+18000,base/1000+604800,0,0)).event,null);
 assert.equal(observeQuotaResets(s,{scope:'a',at:base+10000,buckets:[]}),s);
});
test('notification delivery respects coalescing, stale state, toggle and restart deduplication',()=>{
 let time=base,persisted={},shown=[];
 const make=()=>createResetNotifier({read:()=>persisted,save:v=>persisted=v,show:v=>shown.push(v),now:()=>time});
 const n=make(),event={id:'a',at:base,deliverAfter:base+20000,roles:['weekly']};
 n.observe(event);assert.equal(shown.length,0);time+=20000;n.observe(event,{stale:true});assert.equal(shown.length,0);
 n.observe(event);assert.equal(shown.length,1);assert.match(shown[0][0],/每周/);n.observe(event);make().observe(event);assert.equal(shown.length,1);
 const off={...event,id:'b'};n.observe(off,{enabled:false});n.observe(off);assert.equal(shown.length,1);
 time+=600001;n.observe({...event,id:'old'});assert.equal(shown.length,1);
});
test('live quota manager persists reset events and does not infer resets when account identity lookup fails',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'quota-reset-'));let at=base,observation=reading(at),fail=false;
 const make=()=>createQuotaManager({home,now:()=>at,read:async()=>({rateLimits:observation.buckets[0]}),onObservation:async()=>{if(fail)throw Error('history unavailable');return 'account:test';}});
 try{
  let manager=make();await manager.refresh();assert.equal(manager.state().resetNotification,null);
  at+=10000;observation=reading(at,base/1000+18000,base/1000+604800,0,0);fail=true;await manager.refresh();assert.equal(manager.state().resetNotification,null);
  fail=false;at+=10000;await manager.refresh();const event=manager.state().resetNotification;assert.deepEqual(event.roles,['five','weekly']);
  manager=make();at+=10000;await manager.refresh();assert.equal(manager.state().resetNotification.id,event.id);
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
