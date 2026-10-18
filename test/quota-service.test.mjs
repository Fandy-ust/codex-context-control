import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {createQuotaAnalyticsService} from '../src/quota-analytics-service.mjs';
test('analytics groups salted account observations without persisting account identifiers',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'qa-private-')),historyHome=path.join(home,'history');fs.mkdirSync(historyHome);
 const service=createQuotaAnalyticsService({home,historyHome});
 try{const at=Date.now(),buckets=[{id:'codex',primary:{usedPercent:10,windowDurationMins:10080,resetsAt:Math.floor(at/1000)+86400}}];
 const scope=await service.record({account:{type:'chatgpt',email:'private@example.test',planType:'plus'},buckets,at});assert.match(scope,/^account:[a-f0-9]{32}$/);
 const report=await service.report({days:28});assert.equal(report.scope,scope);assert.equal(report.overview.weeklyUsed,10);
 assert.ok(!JSON.stringify(report).includes('private@example.test'));
 for(const name of fs.readdirSync(home).filter(n=>n.startsWith('quota-history')))assert.ok(!fs.readFileSync(path.join(home,name)).includes(Buffer.from('private@example.test')));
 }finally{service.close();await new Promise(r=>setTimeout(r,200));fs.rmSync(home,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
