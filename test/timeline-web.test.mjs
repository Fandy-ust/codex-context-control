import test from 'node:test';
import assert from 'node:assert/strict';
import {timelineData,nearestBucket} from '../src/timeline-data.mjs';
test('timeline bins preserve all responses and events, weighted rates, gaps and hit mapping',()=>{
  const response=(index,inputTokens,cachedInputTokens,outputTokens,durationMs)=>({id:'r'+index,index,position:index*3,inputTokens,cachedInputTokens,outputTokens,durationMs,tokensPerSecond:durationMs?outputTokens/(durationMs/1000):null,config:{model:'fixture'},segment:0,cacheSegment:0,inputSegment:0,eventType:'final'});
  const responses=[response(1,100,0,10,1000),response(2,200,100,30,3000),response(3,null,null,null,null),response(4,400,300,80,2000),response(5,500,400,100,2000)];
  const events=[{id:'u',position:1,eventType:'user_input'},{id:'c',position:10,eventType:'compaction'}];
  const data=timelineData(responses,events,{limit:3});
  assert.equal(data.entries.length,7);assert.equal(data.buckets.length,3);assert.equal(data.buckets.reduce((n,b)=>n+b.responses,0),5);assert.equal(data.buckets[0].speed,10);assert.equal(data.buckets[0].inputMean,150);assert.equal(data.buckets.reduce((n,b)=>n+b.compactions,0),1);
  assert.equal(nearestBucket(data,-100),0);assert.equal(nearestBucket(data,10000),2);
  const gaps=timelineData(responses,[],{limit:120});assert.notEqual(gaps.speed[1].series,gaps.speed[2].series);
  const eventsOnly=timelineData([],events);assert.equal(eventsOnly.entries.length,2);assert.equal(eventsOnly.buckets.reduce((n,b)=>n+b.users,0),1);assert.deepEqual(eventsOnly.speed,[]);
});
