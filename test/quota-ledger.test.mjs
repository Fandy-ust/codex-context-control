import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {QuotaLedger, projectQuota} from '../src/analytics/ledger.mjs';
const now = Date.now();
const event = (type, payload, at = now - 60000) => JSON.stringify({timestamp: new Date(at).toISOString(), type, payload}) + '\n';
const usage = (id = 'response-a', thread = 'a') => event('token_usage_record', {response_id: id, thread_id: thread, usage: {input_tokens: 100, output_tokens: 20, cached_input_tokens: 80, reasoning_output_tokens: 10}});
const limits = () => event('event_msg', {type: 'token_count', rate_limits: {limit_id: 'codex', primary: {used_percent: 20, window_minutes: 10080, resets_at: Math.floor(now / 1000) + 3600}}});
function fixture() {const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-ledger-'));const home = path.join(dir, 'codex');fs.mkdirSync(home);const file = path.join(home, 'a.jsonl');return {dir, home, file, row: {id: 'a', rollout_path: file, cwd: path.join(dir, 'project'), name: 'Fixture'}, ledger: new QuotaLedger({file: path.join(dir, 'history.sqlite'), home, now: () => now})};}
test('incremental scans persist offsets, deduplicate requests and retain only numeric observations', () => {
 const f = fixture();try {
 fs.writeFileSync(f.file, event('turn_context', {model: 'Sol'}) + event('response_item', {role: 'user', content: 'PRIVATE MESSAGE'}) + usage() + limits());
 f.ledger.scan({rows: [f.row]});let report = f.ledger.read();assert.equal(report.requests.length, 1);assert.equal(report.snapshots.length, 1);assert.equal(report.requests[0].input + report.requests[0].output, 120);
 assert.ok(!JSON.stringify(report).includes('PRIVATE MESSAGE'));
 assert.equal(f.ledger.scan({rows: [f.row]}).bytesRead, 0);
 fs.appendFileSync(f.file, usage() + usage('response-b'));
 f.ledger.scan({rows: [f.row]});assert.equal(f.ledger.read().requests.length, 2);
 const second = path.join(f.home, 'b.jsonl');fs.writeFileSync(second, usage('response-b', 'a'));
 f.ledger.scan({rows: [{...f.row, id: 'b', rollout_path: second}]});assert.equal(f.ledger.read().requests.length, 2, 'copied parent usage is not billed to the fork');
 } finally {f.ledger.close();fs.rmSync(f.dir, {recursive: true, force: true});}
});
test('partial lines, large message records, replacements and unsafe paths are handled without resetting history', () => {
 const f = fixture();try {
 const record = usage();fs.writeFileSync(f.file, record.slice(0, -1));f.ledger.scan({rows: [f.row]});assert.equal(f.ledger.read().requests.length, 0);
 fs.appendFileSync(f.file, '\n');f.ledger.scan({rows: [f.row]});assert.equal(f.ledger.read().requests.length, 1);
 fs.appendFileSync(f.file, event('response_item', {content: 'x'.repeat(2 * 1024 * 1024)}) + usage('response-c'));
 f.ledger.scan({rows: [f.row]});assert.equal(f.ledger.read().requests.length, 2);
 fs.writeFileSync(f.file, usage('response-new'));f.ledger.scan({rows: [f.row]});assert.equal(f.ledger.read().requests.length,3,'replacing history does not refund earlier requests');
 const outside = path.join(f.dir, 'outside.jsonl');fs.writeFileSync(outside, usage('outside'));f.ledger.scan({rows: [{...f.row, rollout_path: outside}]});assert.equal(f.ledger.read().requests.length, 3);
 } finally {f.ledger.close();fs.rmSync(f.dir, {recursive: true, force: true});}
});
test('cycle identification uses reported duration rather than primary/secondary position', () => {
 const p = projectQuota({primary: {usedPercent: 17, windowDurationMins: 10080, resetsAt: 1000}, secondary: {usedPercent: 25, windowDurationMins: 300, resetsAt: 2000}}, {at: now});
 assert.equal(p.weeklyUsed, 17);assert.equal(p.fiveUsed, 25);
 assert.equal(projectQuota({primary: {usedPercent: 20, windowDurationMins: 15, resetsAt: 1000}}, {at: now}), null);
});

test('cost history backfills a year and rescans upgraded files without double counting',()=>{
 const f=fixture();try{
  const old=now-200*86400000;
  fs.writeFileSync(f.file,event('turn_context',{model:'gpt-6.1-sol'},old)+event('token_usage_record',{response_id:'year-old',thread_id:'a',usage:{input_tokens:100,output_tokens:20,cached_input_tokens:60,cache_write_input_tokens:40}},old));
  f.ledger.scan({rows:[f.row]});assert.equal(f.ledger.read(84).requests.length,0);
  assert.equal(f.ledger.read(366).requests[0].written,40);
  f.ledger.setMetadata('costHistoryVersion',0);f.ledger.close();
  f.ledger=new QuotaLedger({file:path.join(f.dir,'history.sqlite'),home:f.home,now:()=>now});
  assert.ok(f.ledger.scan({rows:[f.row]}).bytesRead>0);assert.equal(f.ledger.read(366).requests.length,1);
  assert.equal(f.ledger.scan({rows:[f.row]}).bytesRead,0);
 }finally{f.ledger.close();fs.rmSync(f.dir,{recursive:true,force:true});}
});


test('intra-minute one-percent changes and credit-only readings are retained',()=>{
 const f=fixture();try{
 const at=Math.floor(now/60000)*60000;
 for(let i=0;i<3;i++)f.ledger.recordLive({scope:'account:'+ 'a'.repeat(32),at:at+i*1000,buckets:[{id:'codex',primary:{usedPercent:10+i,windowDurationMins:300,resetsAt:Math.floor(now/1000)+3600},creditBalance:String(150-i)}]});
 const rows=f.ledger.read().snapshots;assert.deepEqual(rows.map(p=>p.fiveUsed),[10,11,12]);assert.deepEqual(rows.map(p=>p.credits),[150,149,148]);
 assert.equal(projectQuota({credits:{balance:'123.5'}},{at:now}).credits,123.5);
 assert.equal(projectQuota({credits:{balance:'123.5',unlimited:true}},{at:now}),null);
 }finally{f.ledger.close();fs.rmSync(f.dir,{recursive:true,force:true});}
});

test('upgrading minute-level snapshot keys does not duplicate observations during backfill',()=>{
 const f=fixture();try{
  const value={at:now-1000,scope:'history',bucket:'codex',weeklyUsed:20,weeklyReset:Math.floor(now/1000)+3600,fiveUsed:null,fiveReset:null};
  const legacy=JSON.stringify([value.scope,value.bucket,Math.floor(value.at/60000),value.weeklyReset,value.fiveReset]);
  f.ledger.db.prepare('INSERT INTO snapshots VALUES (?,?,?,?,?)').run(legacy,'a','history',value.at,JSON.stringify(value));f.ledger.setMetadata('quotaSamplingVersion',0);f.ledger.close();
  f.ledger=new QuotaLedger({file:path.join(f.dir,'history.sqlite'),home:f.home,now:()=>now});f.ledger.snapshot(value,'a');assert.equal(f.ledger.read().snapshots.length,1);
 }finally{f.ledger.close();fs.rmSync(f.dir,{recursive:true,force:true});}
});
