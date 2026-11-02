import test from 'node:test';
import assert from 'node:assert/strict';
import {contextScheduleQuotaGate} from '../src/core/context-schedule-quota.mjs';
import {queueQuotaGate,defaultQueueConfig} from '../src/task-queues.mjs';
const now=1700000000000;
const observation=()=>({stale:false,accountScope:'current',updatedAt:now,buckets:[{id:'codex',hasCredits:true,creditBalance:'120.5',primary:{usedPercent:0,remainingPercent:100,windowDurationMins:300,resetsAt:now/1000+3600},secondary:{usedPercent:100,remainingPercent:0,windowDurationMins:10080,resetsAt:now/1000+86400}}]});
const gate=(q,config={})=>contextScheduleQuotaGate(queueQuotaGate(defaultQueueConfig(),q,now),q,config,now);
test('identified fresh extra Credits allow handoffs while ordinary queue reserves remain blocked',()=>{
 const q=observation();assert.equal(queueQuotaGate(defaultQueueConfig(),q,now).blocked,true);
 assert.equal(gate(q).source,'credits');assert.equal(gate(q).blocked,false);assert.equal(gate(q).hard,false);
 q.buckets[0].creditBalance='0';q.buckets[0].unlimitedCredits=true;assert.equal(gate(q).blocked,false);
});
test('unknown, exhausted, stale or wrong-pool Credits cannot authorize handoffs',()=>{
 for(const change of [q=>q.stale=true,q=>delete q.stale,q=>q.accountScope='unidentified',q=>delete q.accountScope,q=>q.updatedAt=now-30001,q=>q.updatedAt=now+2000,q=>q.buckets[0].creditBalance='0',q=>q.buckets[0].creditBalance='',q=>q.buckets[0].creditBalance='NaN',q=>q.buckets[0].creditBalance='-1',q=>q.buckets[0].hasCredits=false,q=>{delete q.buckets[0].creditBalance;},q=>{q.buckets[0].hasCredits=false;q.buckets.push({id:'other',hasCredits:true,creditBalance:'100'}); }]){
  const q=observation();change(q);assert.equal(gate(q).blocked,true);
 }
});
test('handoffs honor the existing Credits stop trigger and reject unknown protection evidence',()=>{
 const q=observation(),either={stopOnCreditsEnabled:true,creditsTrigger:'either'},both={stopOnCreditsEnabled:true,creditsTrigger:'both'};
 assert.equal(gate(q,either).reason,'credits_protection');assert.equal(gate(q,either).blocked,true);
 assert.equal(gate(q,both).blocked,false);
 q.buckets[0].primary.usedPercent=100;q.buckets[0].primary.remainingPercent=0;assert.equal(gate(q,both).blocked,true);
 delete q.buckets[0].primary;assert.equal(gate(q,either).reason,'credits_protection_unknown');
});
