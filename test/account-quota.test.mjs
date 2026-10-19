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
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-quota-')),binary=path.join(dir,'native-fixture.cjs'),log=path.join(dir,'methods.jsonl');
 try{fs.writeFileSync(binary,String.raw`#!/usr/bin/env node
const fs=require('node:fs');require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(m.method)+'\n');if(m.id)process.stdout.write(JSON.stringify({id:m.id,result:m.method==='initialize'?{}:{rateLimits:{primary:{usedPercent:15,windowDurationMins:300}}}})+'\n');});
`,{mode:0o700});
 const response=await readAccountQuota({binary:process.execPath,launcherArgs:[binary]});assert.equal(normalizeQuota(response)[0].primary.remainingPercent,85);assert.deepEqual(fs.readFileSync(log,'utf8').trim().split('\n').map(JSON.parse),['initialize','initialized','account/rateLimits/read']);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('only concrete finite credit balances are exposed, including credit-only accounts',()=>{
 assert.equal(creditBalance({hasCredits:true,balance:' 1234.5678000 '}),'1234.5678000');
 assert.equal(creditBalance({balance:'0'}),'0');assert.equal(creditBalance({balance:12.5}),'12.5');
 for(const value of [null,{}, {hasCredits:true}, {balance:'Available'}, {balance:'-1'}, {balance:'Infinity'}, {balance:''}, {balance:'0',unlimited:true}])assert.equal(creditBalance(value),null);
 assert.equal(normalizeQuota({rateLimits:{credits:{balance:'25'}}})[0].creditBalance,'25');
});

test('credit baselines persist across restarts, reset on request, and remain separated by account observation',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'qa-credit-state-'));let at=1000000,balance='100',scope='account:a';
 const options={home,now:()=>at,read:async()=>({rateLimits:{credits:{balance}}}),onObservation:async()=>scope};
 try{let manager=createQuotaManager(options);await manager.refresh();assert.equal(manager.state().creditBaselines.codex.baseline,100);
 at+=300001;balance='70';await manager.refresh();assert.equal(manager.state().creditBaselines.codex.baseline,100);
 manager=createQuotaManager(options);at+=300001;await manager.refresh();assert.equal(manager.state().creditBaselines.codex.baseline,100);manager.resetCredits('codex');assert.equal(manager.state().creditBaselines.codex.baseline,70);
 scope='account:b';at+=300001;balance='20';await manager.refresh();assert.equal(manager.state().creditBaselines.codex.baseline,20);
 scope='account:a';at+=300001;balance='65';await manager.refresh();assert.equal(manager.state().creditBaselines.codex.baseline,70);
 await assert.rejects(async()=>manager.resetCredits('__proto__'));
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});

test('optional account metadata uses a read-only request and is never exposed in quota state',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qa-account-')),file=path.join(dir,'fixture.cjs'),log=path.join(dir,'calls.jsonl');
 try{fs.writeFileSync(file,`const fs=require('fs');require('readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({method:m.method,params:m.params})+'\\n');if(m.id)process.stdout.write(JSON.stringify({id:m.id,result:m.method==='account/read'?{account:{type:'chatgpt',email:'fixture@example.test',planType:'plus'}}:m.method==='account/rateLimits/read'?{rateLimits:{primary:{usedPercent:2,windowDurationMins:300}}}:{}})+'\\n');});`);
 const response=await readAccountQuota({binary:process.execPath,launcherArgs:[file],includeAccount:true});assert.equal(response.account.email,'fixture@example.test');
 const calls=fs.readFileSync(log,'utf8').trim().split('\n').map(JSON.parse);assert.deepEqual(calls.find(p=>p.method==='account/read').params,{refreshToken:false});assert.ok(!calls.some(p=>/login|logout|consume/.test(p.method)));
 const manager=createQuotaManager({read:async()=>response});await manager.refresh();assert.ok(!JSON.stringify(manager.state()).includes('fixture@example.test'));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('legacy credit baselines import only against the matching balance and never replace an explicit reset',async()=>{
 let now=1000000;const manager=createQuotaManager({now:()=>now,read:async()=>({rateLimits:{credits:{balance:'70'}}})});await manager.refresh();
 manager.resetCredits('codex',{last:60,baseline:200});assert.equal(manager.state().creditBaselines.codex.baseline,70);
 manager.resetCredits('codex',{last:70,baseline:100});assert.equal(manager.state().creditBaselines.codex.baseline,100);
 manager.resetCredits('codex');manager.resetCredits('codex',{last:70,baseline:200});assert.equal(manager.state().creditBaselines.codex.baseline,70);
});
test('quota values and credit baselines become visible together after an observation finishes',async()=>{
 let finish;const observed=new Promise(r=>finish=r),manager=createQuotaManager({read:async()=>({rateLimits:{credits:{balance:'100'}}}),onObservation:()=>observed});
 const pending=manager.refresh();await new Promise(r=>setImmediate(r));assert.equal(manager.state().buckets.length,0);assert.equal(manager.state().updatedAt,null);
 finish('account:test');await pending;assert.equal(manager.state().buckets[0].creditBalance,'100');assert.equal(manager.state().creditBaselines.codex.baseline,100);
});

test('default quota polling observes changes every ten seconds with concurrent reads coalesced',async()=>{
 let clock=100000,reads=0;const observations=[];
 const manager=createQuotaManager({now:()=>clock,read:async()=>{reads++;return {rateLimits:{primary:{usedPercent:reads,windowDurationMins:300}}}},onObservation:p=>observations.push(p)});
 await manager.refresh();clock+=9999;await manager.refresh();assert.equal(reads,1);
 clock++;await Promise.all([manager.refresh(),manager.refresh()]);assert.equal(reads,2);assert.equal(observations.length,2);
});
