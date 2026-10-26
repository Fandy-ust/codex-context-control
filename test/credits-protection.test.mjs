import test from 'node:test';
import assert from 'node:assert/strict';
import {exhaustedQuota} from '../src/core/credits-protection.mjs';
import {createCreditsProtection} from '../src/credits-protection.mjs';
import {createResetNotifier} from '../desktop/quota-reset-notifications.mjs';
import {Bridge} from '../src/bridge.mjs';
const time=1800000000000;
const reading=(five=100,weekly=100,scope='a')=>({accountScope:scope,stale:false,updatedAt:time,buckets:[{id:'codex',primary:{windowDurationMins:300,usedPercent:five},secondary:{windowDurationMins:10080,usedPercent:weekly}}]});
function harness(extra={}){
 let saved={},q=reading(),c={creditsTrigger:'both',stopOnCreditsEnabled:false},calls=0,at=time;
 const options={load:()=>structuredClone(saved),save:v=>saved=structuredClone(v),quota:{state:()=>q},config:()=>c,stop:async()=>{calls++;return {targeted:2,failed:0};},now:()=>at,...extra};
 let manager=createCreditsProtection(options);
 return {get manager(){return manager;},get saved(){return saved;},get calls(){return calls;},set config(v){c={...c,...v};},set quota(v){q=v;},advance(){at++;q={...q,updatedAt:at};},restart(){manager=createCreditsProtection(options);}};
}
test('both quota windows must be exhausted by default; either is an explicit option',()=>{
 assert.equal(exhaustedQuota(reading(),undefined,time),true);
 assert.equal(exhaustedQuota(reading(100,20),undefined,time),false);
 assert.equal(exhaustedQuota(reading(100,20),'either',time),true);
 assert.equal(exhaustedQuota(reading(99.99,99.99),'both',time),false);
});
test('stale, remote-only, partial, future, invalid and unidentified readings never trigger',()=>{
 for(const q of [{...reading(),stale:true},{...reading(),updatedAt:time-31000},{...reading(),updatedAt:time+5000},{...reading(),accountScope:null},{...reading(),accountScope:'unidentified'},{...reading(),buckets:[]},reading(NaN),reading(101),{...reading(),buckets:[{id:'codex',primary:{usedPercent:100,windowDurationMins:300}}]}])assert.equal(exhaustedQuota(q,'either',time),null);
});
test('notification fires once, stop defaults off, enabling it stops once even across restarts',async()=>{
 const h=harness();await h.manager.tick();const id=h.manager.state().event.id;assert.equal(h.calls,0);
 h.advance();await h.manager.tick();assert.equal(h.manager.state().event.id,id);
 h.config={stopOnCreditsEnabled:true};await Promise.all([h.manager.tick(),h.manager.tick()]);assert.equal(h.calls,1);
 h.restart();h.advance();await h.manager.tick();assert.equal(h.calls,1);
 h.config={stopOnCreditsEnabled:false};await h.manager.tick();h.config={stopOnCreditsEnabled:true};await h.manager.tick();assert.equal(h.calls,1);
});
test('fresh quota recovery rearms the next episode; stale recovery does not',async()=>{
 const h=harness();h.config={stopOnCreditsEnabled:true};await h.manager.tick();const old=h.manager.state().event.id;
 h.quota={...reading(20,20),stale:true};await h.manager.tick();h.quota=reading();await h.manager.tick();assert.equal(h.calls,1);
 h.quota=reading(20,20);h.advance();await h.manager.tick();h.quota=reading();h.advance();await h.manager.tick();assert.equal(h.calls,2);assert.notEqual(h.manager.state().event.id,old);
});
test('each account has a separate episode and switching back does not repeat interruption',async()=>{
 const h=harness();h.config={stopOnCreditsEnabled:true};await h.manager.tick();
 h.quota=reading(100,100,'b');await h.manager.tick();assert.equal(h.calls,2);
 h.quota=reading();await h.manager.tick();assert.equal(h.calls,2);
});
test('a failed or uncertain stop is claimed before dispatch and never replayed',async()=>{
 let calls=0;const h=harness({stop:async()=>{calls++;throw Error('offline');}});h.config={stopOnCreditsEnabled:true};await h.manager.tick();assert.equal(h.saved.accounts.a.stopped,true);assert.equal(h.manager.state().result.status,'error');
 h.restart();await h.manager.tick();assert.equal(calls,1);
});
test('desktop banner uses risk wording and deduplicates across application restarts',async()=>{
 const h=harness();await h.manager.tick();const event=h.manager.state().event;let saved={},shown=[];
 const make=()=>createResetNotifier({read:()=>saved,save:v=>saved=v,show:text=>shown.push(text),now:()=>time});
 make().observe(event);make().observe(event);assert.equal(shown.length,1);assert.match(shown[0][0],/可能使用 Credits/);
});
test('bulk interruption captures current turns once and does not interrupt replacement turns',async()=>{
 const records=new Map([['a',{id:'a',status:'active',turnId:'old'}],['b',{id:'b',status:'active',turnId:'b1'}],['idle',{id:'idle',status:'idle',turnId:'previous'}]]),calls=[];
 const fake={records,rpc:async(method,p)=>{calls.push(p);records.get('b').turnId='b2';}};
 const result=await Bridge.prototype.interruptCurrentTurns.call(fake);assert.deepEqual(calls,[{threadId:'a',turnId:'old'}]);assert.equal(result.failed,0);
});

test('bulk stop reports unconfirmed active turns and rejected interrupts',async()=>{
 const fake={records:new Map([['unknown',{id:'unknown',status:'active'}],['a',{id:'a',status:'active',turnId:'a1'}]]),rpc:async()=>{throw Error('offline');}};
 assert.deepEqual(await Bridge.prototype.interruptCurrentTurns.call(fake),{targeted:2,failed:2});
});

test('configuration persists independently and rejects invalid protection switches',async()=>{
 const {createQuotaActivation}=await import('../src/quota-activation.mjs');let saved={};
 const make=()=>createQuotaActivation({load:()=>saved,save:v=>saved=structuredClone(v),quota:{},probe:async()=>{}});
 const manager=make();assert.equal(manager.state().config.stopOnCreditsEnabled,false);
 manager.command({action:'configure',stopOnCreditsEnabled:true,creditsNotificationsEnabled:false,creditsTrigger:'either'});
 assert.equal(make().state().config.stopOnCreditsEnabled,true);assert.equal(make().state().config.creditsNotificationsEnabled,false);assert.equal(make().state().config.creditsTrigger,'either');
 assert.throws(()=>manager.command({action:'configure',stopOnCreditsEnabled:'true'}));assert.throws(()=>manager.command({action:'configure',creditsTrigger:'unknown'}));
});

test('suspend dispatch before interruption, pause queues, await all peers and report partial failures',async()=>{
 const {stopForCredits}=await import('../src/credits-stop.mjs');const actions=[];
 const queues={suspend:async()=>{actions.push('suspend');return ()=>actions.push('resume');},command:p=>actions.push(p.action)};
 const peer={call:async op=>{assert.equal(op,'credits-stop');actions.push('interrupt');return {targeted:3,failed:0};}},legacy={call:()=>assert.fail('must not call an unsupported runtime')};
 const result=await stopForCredits({queues,quota:{state:()=>({accountScope:'a'})},bridges:new Map([[peer,{creditsStopVersion:1}],[legacy,{}]])},'a');
 assert.deepEqual(actions,['suspend','monitoring','disable-all','interrupt','resume']);assert.equal(result.targeted,3);assert.equal(result.failed,1);assert.equal(result.status,'partial');
});

test('switching accounts during queue suspension cancels interruption and releases suspension',async()=>{
 const {stopForCredits}=await import('../src/credits-stop.mjs');let resumed=false;
 await assert.rejects(stopForCredits({queues:{suspend:async()=>()=>{resumed=true;},command:()=>assert.fail('must not change another account queues')},quota:{state:()=>({accountScope:'b'})},bridges:new Map()},'a'),/Account changed/);assert.equal(resumed,true);
});
