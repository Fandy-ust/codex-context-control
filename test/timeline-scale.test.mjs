import test from 'node:test';
import assert from 'node:assert/strict';
import {timelineData,nearestBucket} from '../src/timeline-data.mjs';
import {timelineX,timelinePosition} from '../src/timeline-scale.mjs';
test('chart curves, event markers and cursor share the same padded scale at every width',()=>{
  const data=timelineData([{id:'r1',index:1,position:2,inputTokens:10,outputTokens:1,durationMs:1000,tokensPerSecond:1,config:{}},{id:'r2',index:2,position:4,inputTokens:20,config:{}}],[{id:'u1',position:1,eventType:'user_input'},{id:'u2',position:3,eventType:'user_input'}]);
  assert.equal(data.buckets[0].position,1.5);
  for(const width of [320,704,720,1080,1600])for(const bucket of data.buckets){
    const svgX=timelineX(bucket.position,data.upperBound,720)/720*width,cssX=timelineX(bucket.position,data.upperBound,100)/100*width;
    assert.ok(Math.abs(svgX-cssX)<1e-9);
    assert.ok(Math.abs(timelinePosition(svgX,data.upperBound,width)-bucket.position)<1e-9);
    assert.equal(nearestBucket(data,timelinePosition(svgX,data.upperBound,width)),bucket.id);
    assert.notEqual(cssX,data.entries[bucket.start].position/data.upperBound*width);
  }
});
test('plot hit testing excludes padding and handles invalid or collapsed dimensions',()=>{
  assert.equal(timelinePosition(0,100,720),null);assert.equal(timelinePosition(720,100,720),null);
  assert.equal(timelinePosition(8,100,720),0);assert.equal(timelinePosition(712,100,720),100);
  assert.equal(timelinePosition(20,100,0),null);assert.equal(timelineX(NaN,100),null);
});
