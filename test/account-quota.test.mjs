import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {normalizeQuota,createQuotaManager,readAccountQuota,creditBalance} from '../src/account-quota.mjs';
test('quota windows report remaining percentages without inventing missing cycles',()=>{
 const buckets=normalizeQuota({rateLimitsByLimitId:{codex:{credits:{hasCredits:true},primary:{usedPercent:100,windowDurationMins:10080,resetsAt:1900000000},secondary:null},other:{primary:{usedPercent:23,windowDurationMins:300},secondary:{usedPercent:null}}},rateLimits:{primary:{usedPercent:10}}});
 assert.equal(buckets[0].hasCredits,true);assert.equal(buckets[0].primary.remainingPercent,0);assert.equal(buckets[0].secondary,null);assert.equal(buckets[1].primary.remainingPercent,77);assert.equal(buckets[1].secondary,null);assert.deepEqual(normalizeQuota({}),[]);assert.equal(normalizeQuota({rateLimits:{primary:{usedPercent:110}}})[0].primary.remainingPercent,0);
});
test('quota refresh is coalesced and cached; failures retain explicitly stale observations',async()=>{
 let time=1000000,calls=0,fail=false;
 const manager=createQuotaManager({now:()=>time,read:async()=>{calls++;if(fail)throw Error('offline');return {rateLimits:{primary:{usedPercent:32}}};}});
 await Promise.all([manager.refresh(),manager.refresh()]);assert.equal(calls,1);await manager.refresh(true);assert.equal(calls,1);assert.equal(manager.state().buckets[0].primary.remainingPercent,68);
 time+=300001;fail=true;await manager.refresh();assert.equal(calls,2);assert.equal(manager.state().stale,true);assert.equal(manager.state().buckets[0].primary.remainingPercent,68);
});

test('native quota session initializes and reads account limits without opening chats',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-quota-')),binary=path.join(dir,'native-fixture'),log=path.join(dir,'methods.jsonl');
 try{fs.writeFileSync(binary,String.raw`#!/usr/bin/env node
const fs=require('node:fs');require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(m.method)+'\n');if(m.id)process.stdout.write(JSON.stringify({id:m.id,result:m.method==='initialize'?{}:{rateLimits:{primary:{usedPercent:15,windowDurationMins:300}}}})+'\n');});
`,{mode:0o700});
 const response=await readAccountQuota({binary});assert.equal(normalizeQuota(response)[0].primary.remainingPercent,85);assert.deepEqual(fs.readFileSync(log,'utf8').trim().split('\n').map(JSON.parse),['initialize','initialized','account/rateLimits/read']);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('only concrete finite credit balances are exposed, including credit-only accounts',()=>{
 assert.equal(creditBalance({hasCredits:true,balance:' 1234.5678000 '}),'1234.5678000');
 assert.equal(creditBalance({balance:'0'}),'0');assert.equal(creditBalance({balance:12.5}),'12.5');
 for(const value of [null,{}, {hasCredits:true}, {balance:'Available'}, {balance:'-1'}, {balance:'Infinity'}, {balance:''}, {balance:'0',unlimited:true}])assert.equal(creditBalance(value),null);
 assert.equal(normalizeQuota({rateLimits:{credits:{balance:'25'}}})[0].creditBalance,'25');
});
