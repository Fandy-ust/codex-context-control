import test from 'node:test';
import assert from 'node:assert/strict';
import {latestObservedSpeed,speedLevel,speedTrendPath} from '../src/core/response-speed.mjs';
import {createRunningSpeedCache} from '../src/running-speed.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('speed follows the latest measured model response and never fabricates missing timings',()=>{
  const measured={id:'r1',turnId:'previous',timestamp:'2026-10-19T00:00:00Z',eventType:'intermediate',timingKind:'observed_generation',outputTokens:300,durationMs:2000};
  assert.equal(latestObservedSpeed([measured,{...measured,id:'compaction',eventType:'compaction'}]).tokensPerSecond,150);
  assert.equal(latestObservedSpeed([{...measured,durationMs:null}]),null);
  assert.equal(latestObservedSpeed([measured,{...measured,id:'r2',turnId:'current',outputTokens:400,durationMs:4000}]).tokensPerSecond,100);
});

test('active speed polls are deduplicated, bounded and fair; idle chats do not trigger work',async()=>{
  let time=0;const calls=[],resolvers=[];
  const cache=createRunningSpeedCache(id=>{calls.push(id);return new Promise(resolve=>resolvers.push(resolve));},{now:()=>time,intervalMs:2000});
  const chats=['a','b','c'].map(id=>({id,connected:true,status:'active'}));chats.push({id:'idle',connected:true,status:'idle'});
  cache.observe(chats);cache.observe(chats);await tick();assert.deepEqual(calls,['a','b']);
  resolvers.splice(0).forEach(resolve=>resolve({tokensPerSecond:42}));await tick();assert.equal(cache.get('a').tokensPerSecond,42);
  time=10000;cache.observe(chats);await tick();assert.equal(calls[2],'c');assert.equal(calls.length,4);
  cache.close();resolvers.splice(0).forEach(resolve=>resolve({tokensPerSecond:99}));await tick();assert.equal(cache.get('a'),null);
});


test('speed colors use exact boundaries and trends retain missing-observation gaps',()=>{
  assert.equal(speedLevel(40),'green');assert.equal(speedLevel(39.9),'yellow');assert.equal(speedLevel(30),'yellow');assert.equal(speedLevel(29.9),'red');assert.equal(speedLevel(0),'red');assert.equal(speedLevel(null),'unknown');assert.equal(speedLevel(NaN),'unknown');
  const path=speedTrendPath([10,20,null,40,30]);assert.equal((path.match(/M/g)||[]).length,2);assert.equal((path.match(/L/g)||[]).length,2);assert.equal(speedTrendPath([null,20]),'');
  const record=outputTokens=>({eventType:'final',timingKind:'observed_generation',outputTokens,durationMs:1000});
  assert.equal(latestObservedSpeed([record(30),record(40)]).direction,'up');assert.equal(latestObservedSpeed([record(40),record(30)]).direction,'down');assert.equal(latestObservedSpeed([record(30),record(30)]).direction,null);
});
