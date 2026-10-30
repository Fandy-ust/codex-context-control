import test from 'node:test';import assert from 'node:assert/strict';
import {retainedCalendarPoints} from '../src/backup-retention.mjs';
test('calendar retention thins a year of daily history into daily, weekly and monthly points',()=>{
 const now=new Date(2026,9,30,12),points=[];
 for(let i=0;i<370;i++){const at=new Date(now);at.setDate(at.getDate()-i);points.push({id:String(i),at:at.toISOString()});}
 const keep=retainedCalendarPoints(points,now);
 for(let i=0;i<7;i++)assert.ok(keep.has(String(i)));
 assert.ok(!keep.has('8'));assert.ok(keep.has('7'));
 assert.ok(keep.size<=15);assert.ok([...keep].every(id=>Number(id)<=92));
 const year=retainedCalendarPoints(points,now,{monthlyMonths:12});assert.ok(year.size>keep.size);
});
test('newest point wins in a calendar bucket and invalid timestamps are rejected',()=>{
 const now=new Date(2026,9,30,12);const keep=retainedCalendarPoints([{id:'old',at:new Date(2026,9,30,8).toISOString()},{id:'new',at:new Date(2026,9,30,9).toISOString()},{id:'bad',at:'bad'}],now);assert.deepEqual([...keep],['new']);
});
