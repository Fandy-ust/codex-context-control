import test from 'node:test';
import assert from 'node:assert/strict';
import {accountSummary} from '../src/core/account-summary.mjs';
test('account display summaries allowlist fields and preserve original reset and observation times',()=>{
 const now=1800000000000,value={id:'a'.repeat(32),label:'a@example.test',customName:'Work',updatedAt:now,auth:{tokens:{refresh_token:'SECRET'}},quota:{updatedAt:now-60000,auth:'SECRET',buckets:[{id:'codex',creditBalance:'43',access_token:'SECRET',primary:{remainingPercent:95,windowDurationMins:300,resetsAt:1800001800,token:'SECRET'}}]}};
 const summary=accountSummary(value,now);assert.equal(summary.quota.updatedAt,now-60000);assert.equal(summary.quota.buckets[0].primary.resetsAt,1800001800);assert.equal(summary.quota.buckets[0].primary.usedPercent,5);assert.equal(JSON.stringify(summary).includes('SECRET'),false);
 assert.equal(accountSummary({...value,quota:{...value.quota,updatedAt:now+600000}},now).quota,undefined);assert.equal(accountSummary({...value,id:'bad'},now),null);
});
