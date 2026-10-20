import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {createQuotaAnalyticsService} from '../src/quota-analytics-service.mjs';

test('worker imports numeric cloud records into reports without re-exporting them and preserves plan aliases',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'qa-cloud-')),service=createQuotaAnalyticsService({home,historyHome:home});
 try{
  const at=Date.now(),buckets=[{id:'codex',primary:{usedPercent:10,windowDurationMins:10080,resetsAt:Math.floor(at/1000)+86400}}],account={type:'chatgpt',email:'cloud@example.test',planType:'plus'};
  const scope=await service.record({account,buckets,at}),cloudAccount=service.syncAccount(Buffer.alloc(32,1));
  await service.syncImport({account:'a'.repeat(32),scope,shards:[{id:'remote',data:{version:1,requests:[{id:'remote-response',at:at-1000,model:'Sol',input:300,output:30,cached:200,written:0}],snapshots:[]}}]});
  assert.equal((await service.report({days:28})).quality.requests,1);assert.equal((await service.syncExport()).requests.length,0);
  await service.syncImport({enabled:false});assert.equal((await service.report({days:28})).quality.requests,0);
  await service.record({account:{...account,planType:'pro'},buckets,at:at+1000});assert.equal(service.syncAccount(Buffer.alloc(32,1)),cloudAccount);
  assert.equal((await service.syncExport()).snapshots.length,2);
 }finally{await service.close();fs.rmSync(home,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
test('analytics groups salted account observations without persisting account identifiers',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'qa-private-')),historyHome=path.join(home,'history');fs.mkdirSync(historyHome);
 const service=createQuotaAnalyticsService({home,historyHome,idleMs:25});
 try{const at=Date.now(),buckets=[{id:'codex',primary:{usedPercent:10,windowDurationMins:10080,resetsAt:Math.floor(at/1000)+86400}}];
 const scope=await service.record({account:{type:'chatgpt',email:'private@example.test',planType:'plus'},buckets,at});assert.match(scope,/^account:[a-f0-9]{32}$/);
 const report=await service.report({days:28});assert.equal(report.scope,scope);assert.equal(report.overview.weeklyUsed,10);
 assert.ok(!JSON.stringify(report).includes('private@example.test'));
 for(let attempt=0;attempt<4;attempt++){await new Promise(r=>setTimeout(r,75));assert.equal((await service.report({days:28})).scope,scope,'idle worker restart preserves the ledger');}
 await service.close();
 for(const name of fs.readdirSync(home).filter(n=>n.startsWith('quota-history')))assert.ok(!fs.readFileSync(path.join(home,name)).includes(Buffer.from('private@example.test')));
 }finally{await service.close();fs.rmSync(home,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
test('a worker startup failure does not poison later attempts or overwrite a future ledger',async()=>{
 const {DatabaseSync}=await import('node:sqlite'),home=fs.mkdtempSync(path.join(os.tmpdir(),'qa-recover-')),historyHome=path.join(home,'history');fs.mkdirSync(historyHome);
 const file=path.join(home,'quota-history.sqlite');let db=new DatabaseSync(file);db.exec("CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL); INSERT INTO meta VALUES('schema','2')");db.close();
 const service=createQuotaAnalyticsService({home,historyHome});
 try{await assert.rejects(service.report({days:28}));db=new DatabaseSync(file);assert.equal(db.prepare("SELECT value FROM meta WHERE key='schema'").get().value,'2');db.exec("UPDATE meta SET value='1' WHERE key='schema'");db.close();assert.equal((await service.report({days:28})).schemaVersion,1);}
 finally{await service.close();fs.rmSync(home,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});


test('encrypted account profiles survive restart and keep stable cross-device identities across plan changes',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'qa-profiles-'));let service=createQuotaAnalyticsService({home,historyHome:home});
 try{
  const at=Date.now(),key=Buffer.alloc(32,8),account={type:'chatgpt',id:'account-stable-id',email:'profile@example.test',planType:'plus'};
  await service.record({account,buckets:[],at});const first=(await service.syncProfiles(key))[0];
  await service.record({account:{...account,planType:'pro'},buckets:[],at:at+1});
  assert.equal((await service.syncProfiles(key)).length,1);assert.equal((await service.syncProfiles(key))[0].scopes.length,2);
  await service.close();service=createQuotaAnalyticsService({home,historyHome:home});
  const restored=(await service.syncProfiles(key))[0];assert.equal(restored.id,first.id);assert.equal(restored.label,account.email);
  assert.notEqual((await service.syncProfiles(Buffer.alloc(32,9)))[0].id,first.id,'new sync key creates isolated namespaces');
  await service.close();
  for(const name of fs.readdirSync(home).filter(n=>n.startsWith('quota-history'))){const bytes=fs.readFileSync(path.join(home,name));assert.equal(bytes.includes(Buffer.from(account.email)),false);assert.equal(bytes.includes(Buffer.from(account.id)),false);}
 }finally{await service.close();fs.rmSync(home,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
