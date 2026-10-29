import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createQuotaObserver} from '../src/passive-quota.mjs';
import {createPassiveQuotaStore} from '../src/passive-quota-store.mjs';
import {createQuotaManager} from '../src/account-quota.mjs';
import {Bridge} from '../src/bridge.mjs';

const account={type:'chatgpt',email:'test@example.test',planType:'plus'};
const limits={codex:{primary:{usedPercent:20,windowDurationMins:300,resetsAt:1900000000}}};
test('passive snapshots merge sparse limit notifications, retain original time and clear on account changes',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'passive-quota-'));let now=1000000;
 try{
  const store=createPassiveQuotaStore({home,now:()=>now});const observer=createQuotaObserver(v=>{if(v.invalidated)store.invalidate();else store.observe(v);},()=>now);
  observer.observe('account/rateLimits/read',{rateLimitsByLimitId:limits});await Promise.resolve();assert.throws(()=>store.read());
  observer.observe('account/read',{account:{...account,access_token:'secret'}});await Promise.resolve();
  const manager=createQuotaManager({home,now:()=>now,read:()=>store.read()});await manager.refresh();assert.equal(manager.state().buckets[0].primary.usedPercent,20);
  now+=30000;await manager.refresh();assert.equal(manager.state().updatedAt,1000000);assert.equal(manager.state().stale,true,'reading the cache must not make an old observation fresh');
  observer.observe('account/rateLimits/updated',{rateLimits:{limitId:'other',primary:{usedPercent:42},secret:'secret'}});await Promise.resolve();
  assert.deepEqual(Object.keys(store.read().rateLimitsByLimitId).sort(),['codex','other']);
  assert.equal(JSON.stringify(store.read()).includes('secret'),false);
  const restarted=createPassiveQuotaStore({home,now:()=>now});assert.equal(restarted.read().observedAt,now);
  observer.observe('account/updated',{planType:'plus'});await Promise.resolve();assert.throws(()=>store.read());
  observer.observe('account/read',{account:{...account,email:'other@example.test'}});await Promise.resolve();assert.throws(()=>store.read(),'a new account must not inherit old limits');
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});

test('bridge forwards native quota traffic unchanged without adding backend RPCs',async()=>{
 const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();
 const input=new PassThrough(),output=new PassThrough(),backend=[],frontend=[],observed=[];
 child.stdin.on('data',v=>backend.push(v.toString()));output.on('data',v=>frontend.push(v.toString()));
 const bridge=new Bridge(child,input,output,undefined,undefined,{observeQuota:v=>observed.push(v)});
 try{
  bridge.fromClient(JSON.stringify({id:1,method:'account/read',params:{refreshToken:false}}));
  bridge.fromServer(JSON.stringify({id:1,result:{account}}));
  const notification=JSON.stringify({method:'account/rateLimits/updated',params:{rateLimitsByLimitId:limits}});
  bridge.fromServer(notification);await Promise.resolve();await Promise.resolve();
  assert.equal(backend.length,1,'the observer must not send initialize, rateLimits/read or other RPCs');
  assert.equal(frontend.at(-1),notification+'\n');assert.equal(observed.length,1);assert.equal(observed[0].account.email,account.email);
 }finally{bridge.frontLines.close();bridge.backLines.close();for(const s of [input,output,child.stdin,child.stdout])s.destroy();}
});

test('default quota refresh never starts a runtime when no desktop observation is available',async()=>{
 const manager=createQuotaManager();await manager.refresh(true);assert.deepEqual(manager.state().buckets,[]);assert.equal(manager.state().stale,true);
});
