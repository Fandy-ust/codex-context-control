import test from 'node:test';
import assert from 'node:assert/strict';
import {createQuotaActivation} from '../src/quota-activation.mjs';
import {activationRecommendation,resetConfirmed,HOUR,WEEK} from '../src/core/quota-activation.mjs';
import {nextActivationAt,latestActivationAt} from '../src/core/activation-schedule.mjs';
import {spawnSync} from 'node:child_process';

function harness(saved={}){
  let time=1800000000000,sends=0,persisted;
  const q={updatedAt:time,stale:false,accountScope:'a',buckets:[{id:'codex',primary:{windowDurationMins:300,usedPercent:0,resetsAt:time/1000-1},secondary:{windowDurationMins:10080,usedPercent:0,resetsAt:time/1000-1}}]};
  const manager=createQuotaActivation({load:()=>saved,save:v=>{persisted=structuredClone(v);},now:()=>time,quota:{state:()=>q,refresh:async()=>{q.updatedAt=time;}},probe:async()=>{sends++;}});
  return {manager,q,advance(ms){time+=ms;},get now(){return time;},get sends(){return sends;},get saved(){return persisted;}};
}

test('tomorrow-only always uses tomorrow, accepts only a valid local time and fires once',async()=>{
 const h=harness(),today=new Date(h.now),expected=new Date(today.getFullYear(),today.getMonth(),today.getDate()+1,6,35).getTime();
 h.manager.command({action:'configure',scheduleMode:'once',scheduleTime:'06:35'});assert.equal(h.saved.config.scheduledAt,expected);
 for(const time of ['24:00','12:60','6:35','bad'])assert.throws(()=>h.manager.command({action:'configure',scheduleMode:'daily',scheduleTime:time}));
 assert.equal(h.saved.config.scheduledAt,expected,'invalid configuration must preserve the prior reservation');
 h.advance(expected-h.now);await h.manager.tick();assert.equal(h.sends,1);assert.equal(h.saved.config.scheduleMode,'off');assert.equal(h.saved.config.scheduledAt,null);
});

test('daily schedules persist the next local occurrence before sending and survive a restart',async()=>{
 const h=harness();h.manager.command({action:'configure',scheduleMode:'daily',scheduleTime:'08:10'});const due=h.saved.config.scheduledAt;
 h.advance(due-h.now);await h.manager.tick();assert.equal(h.sends,1);assert.equal(h.saved.config.scheduleMode,'daily');
 const next=nextActivationAt('08:10',h.now);assert.equal(h.saved.config.scheduledAt,next);
 const restarted=harness(h.saved);restarted.advance(h.now-restarted.now);await restarted.manager.tick();assert.equal(restarted.sends,0,'a restart must not resend the consumed occurrence');
 h.q.buckets[0].primary.resetsAt=(h.now+5*HOUR)/1000;h.advance(10000);await h.manager.tick();assert.equal(h.saved.job.status,'confirmed');
 h.advance(next-h.now);await h.manager.tick();assert.equal(h.sends,2);assert.equal(h.saved.config.scheduledAt,nextActivationAt('08:10',h.now));
});

test('missed daily occurrences are skipped without cancelling the following day or replaying a backlog',async()=>{
 const h=harness();h.manager.command({action:'configure',scheduleMode:'daily',scheduleTime:'08:10'});const due=h.saved.config.scheduledAt;
 h.advance(due-h.now+3*24*HOUR+20*60000);await h.manager.tick();assert.equal(h.sends,0);assert.equal(h.saved.job.status,'missed');assert.equal(h.saved.config.scheduleMode,'daily');
 const next=h.saved.config.scheduledAt;assert.ok(next>h.now);h.advance(next-h.now);await h.manager.tick();assert.equal(h.sends,1);
});

test('waking within the latest daily grace window sends today once and cancellation removes recurrence',async()=>{
 const h=harness();h.manager.command({action:'configure',scheduleMode:'daily',scheduleTime:'08:10'});const due=h.saved.config.scheduledAt;
 h.advance(due-h.now+2*24*HOUR+5*60000);await h.manager.tick();assert.equal(h.sends,1);assert.equal(h.saved.job.dueAt,latestActivationAt('08:10',h.now));
 h.manager.command({action:'cancel'});assert.equal(h.saved.config.scheduledAt,null);assert.equal(h.saved.config.scheduleMode,'off');h.advance(2*24*HOUR);await h.manager.tick();assert.equal(h.sends,1);
});

test('local calendar scheduling preserves the chosen time over daylight saving changes',()=>{
 const url=new URL('../src/core/activation-schedule.mjs',import.meta.url).href;
 const code=`import {nextActivationAt} from ${JSON.stringify(url)};const a=new Date(2026,9,31,8).getTime(),b=nextActivationAt('08:00',a);const c=new Date(2026,2,7,8).getTime(),d=nextActivationAt('08:00',c);console.log(JSON.stringify({fall:(b-a)/3600000,spring:(d-c)/3600000,hour:new Date(b).getHours()}));`;
 const r=spawnSync(process.execPath,['--input-type=module','-e',code],{env:{...process.env,TZ:'America/New_York'},encoding:'utf8'});assert.equal(r.status,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout),{fall:25,spring:23,hour:8});
});
test('one schedule sends once, verifies a fresh 5h timer, and never repeats',async()=>{
  const h=harness();h.manager.command({action:'configure',scheduledAt:h.now+1000});
  await h.manager.tick();assert.equal(h.sends,0);h.advance(1000);await h.manager.tick();assert.equal(h.sends,1);
  h.q.buckets[0].primary.resetsAt=(h.now+5*HOUR)/1000;h.advance(10000);await h.manager.tick();assert.equal(h.manager.state().job.status,'confirmed');
  h.advance(HOUR);await h.manager.tick();assert.equal(h.sends,1);assert.equal(h.saved.config.scheduledAt,null);
});
test('three unsuccessful attempts are durable and bounded',async()=>{
  const h=harness();h.manager.command({action:'run'});
  for(let i=0;i<8;i++){await h.manager.tick();h.advance(20000);}
  assert.equal(h.sends,3);assert.equal(h.saved.job.status,'failed');
  const restarted=harness(h.saved);await restarted.manager.tick();assert.equal(restarted.sends,0);
});
test('weekly expiry triggers and checks seven days with tolerance',async()=>{
  const h=harness();h.q.buckets[0].secondary.resetsAt=(h.now+1000)/1000;
  h.manager.command({action:'configure',weeklyEnabled:true});await h.manager.tick();assert.equal(h.sends,0);
  h.advance(2000);await h.manager.tick();assert.equal(h.sends,1);
  h.q.buckets[0].secondary.resetsAt=(h.now+WEEK+5*60000)/1000;h.advance(10000);await h.manager.tick();assert.equal(h.saved.job.status,'confirmed');
  await h.manager.tick();assert.equal(h.sends,1);
  assert.equal(resetConfirmed(h.q,10080,h.now,1),false);
});
test('manual full weekly reset is detected before old expiry',async()=>{
  const h=harness();h.manager.command({action:'configure',weeklyEnabled:true});const w=h.q.buckets[0].secondary;w.resetsAt=(h.now+HOUR)/1000;w.usedPercent=80;await h.manager.tick();
  w.usedPercent=0;w.resetsAt=(h.now+WEEK)/1000;h.advance(10000);await h.manager.tick();assert.equal(h.sends,1);
});
test('manual weekly reset can leave the old timestamp until first use',async()=>{
  const h=harness();h.manager.command({action:'configure',weeklyEnabled:true});const w=h.q.buckets[0].secondary;w.resetsAt=(h.now+HOUR)/1000;w.usedPercent=80;await h.manager.tick();
  w.usedPercent=0;h.advance(10000);await h.manager.tick();assert.equal(h.sends,1);
});
test('weekly expiry with a temporarily missing new reset timestamp still starts',async()=>{
  const h=harness();h.manager.command({action:'configure',weeklyEnabled:true});const w=h.q.buckets[0].secondary;w.resetsAt=(h.now+1000)/1000;await h.manager.tick();
  w.resetsAt=null;h.advance(2000);await h.manager.tick();assert.equal(h.sends,1);
});
test('missing Codex window defers sending',async()=>{
  const h=harness();h.q.buckets=[];h.manager.command({action:'run'});await h.manager.tick();assert.equal(h.sends,0);assert.equal(h.saved.job.attempts,0);
});
test('concurrent ticks cannot send twice and cancellation aborts the current probe',async()=>{
  let finish,sends=0,saved;const now=1800000000000;
  const manager=createQuotaActivation({now:()=>now,save:v=>{saved=structuredClone(v);},quota:{refresh:async()=>{},state:()=>({updatedAt:now,buckets:[{id:'codex',primary:{windowDurationMins:300,usedPercent:0,resetsAt:now/1000-1}}]})},probe:({signal})=>new Promise(resolve=>{sends++;finish=resolve;signal.addEventListener('abort',resolve,{once:true});})});
  manager.command({action:'run'});const running=manager.tick();while(!finish)await new Promise(resolve=>setImmediate(resolve));
  await manager.tick();assert.equal(sends,1);manager.command({action:'cancel'});await running;assert.equal(saved.job.status,'cancelled');
});
test('stale quota, missed schedules and already active windows never send',async()=>{
  const h=harness();h.manager.command({action:'configure',scheduledAt:h.now+1000});h.advance(HOUR);await h.manager.tick();assert.equal(h.saved.job.status,'missed');assert.equal(h.sends,0);
  h.manager.command({action:'run'});h.q.stale=true;await h.manager.tick();assert.equal(h.sends,0);
  h.q.stale=false;h.q.buckets[0].primary.usedPercent=2;h.q.buckets[0].primary.resetsAt=(h.now+HOUR)/1000;await h.manager.tick();assert.equal(h.saved.job.status,'already-active');assert.equal(h.sends,0);
});
test('unknown in-flight attempt on restart is not resent',async()=>{
  const h=harness({job:{status:'running',attempts:1,kind:'manual',minutes:300}});await h.manager.tick();assert.equal(h.saved.job.status,'uncertain');assert.equal(h.sends,0);
});
test('cancel clears pending schedule and retries',async()=>{
  const h=harness();h.manager.command({action:'run'});await h.manager.tick();h.manager.command({action:'cancel'});h.advance(HOUR);await h.manager.tick();assert.equal(h.sends,1);assert.equal(h.saved.job.status,'cancelled');
});
test('recommendation estimates three hours consumption as two hours lead',()=>{
  const now=1800000000000,snapshots=[];
  for(let cycle=0;cycle<4;cycle++)for(let i=0;i<=36;i++)snapshots.push({scope:'a',bucket:'codex',at:now-(cycle+1)*24*HOUR+i*5*60000,fiveReset:(now-cycle*24*HOUR)/1000,fiveUsed:i*100/36});
  const r=activationRecommendation({snapshots,currentScope:'a'},{now});assert.equal(r.leadHours,2);assert.equal(r.consumptionHours,3);assert.equal(r.sampleCount,4);
  assert.equal(activationRecommendation({snapshots,currentScope:'b'},{now}).leadHours,null);
});
test('sparse history cannot produce a recommendation',()=>{
  const now=1800000000000,snapshots=[];for(let c=0;c<4;c++)for(let i=0;i<2;i++)snapshots.push({scope:'a',bucket:'codex',at:now-(c+1)*24*HOUR+i*HOUR,fiveReset:(now-c*24*HOUR)/1000,fiveUsed:i*100});
  assert.equal(activationRecommendation({snapshots,currentScope:'a'},{now}).leadHours,null);
});
