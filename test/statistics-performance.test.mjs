import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {readHistory,createHistoryCache,analyzeContext,analyzeEvents} from '../src/context-statistics.mjs';
import {createContextStatisticsService} from '../src/context-statistics-service.mjs';
const ids=['11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333'];
const event=(type,payload)=>({type,payload,timestamp:'2026-10-16T00:00:00Z'});
const message=(role,text)=>({type:'message',role,phase:role==='assistant'?'final':undefined,content:[{type:'input_text',text}]});
const encode=events=>events.map(e=>JSON.stringify(e)).join('\n')+'\n';
const initial=text=>[event('session_meta',{}),event('turn_context',{model:'gpt-6-astra',service_tier:'default'}),event('response_item',message('user',text)),event('response_item',message('assistant','OK')),event('token_usage_record',{response_id:'first',usage:{input_tokens:100,cached_input_tokens:40,cache_write_input_tokens:0,output_tokens:1}})];
function fixture(){const home=fs.mkdtempSync(path.join(os.tmpdir(),'context-perf-')),db=new DatabaseSync(path.join(home,'state_5.sqlite'));db.exec('CREATE TABLE threads(id TEXT,rollout_path TEXT)');const files=ids.map((id,i)=>{const file=path.join(home,id+'.jsonl');fs.writeFileSync(file,encode(initial('thread '+i)));db.prepare('INSERT INTO threads VALUES(?,?)').run(id,file);return file;});db.close();return {home,files,close(){fs.rmSync(home,{recursive:true,force:true});}};}
const stable=data=>{const {generatedAt,...rest}=data;return rest;};
test('incremental history matches cold scans across appends, partial UTF-8, compaction and replacement',()=>{
 const f=fixture(),cache=createHistoryCache();const compare=()=>assert.deepEqual(stable(analyzeEvents(readHistory(f.home,ids[0],cache),ids[0])),stable(analyzeContext(f.home,ids[0])));
 try{
  compare();const bytes=cache.metrics.bytesRead;compare();assert.equal(cache.metrics.bytesRead,bytes);
  const partial=Buffer.from(encode([event('response_item',message('user','新增中文'))]));const cut=partial.indexOf(Buffer.from('中'))+1;
  fs.appendFileSync(f.files[0],partial.subarray(0,cut));compare();fs.appendFileSync(f.files[0],partial.subarray(cut));
  fs.appendFileSync(f.files[0],encode([event('response_item',message('assistant','second')),event('token_usage_record',{response_id:'second',usage:{input_tokens:150,cached_input_tokens:100,cache_write_input_tokens:0,output_tokens:1}})]));compare();assert.ok(cache.metrics.appendReads>=2);
  fs.appendFileSync(f.files[0],encode([event('compacted',{message:'summary',replacement_history:[message('user','summary')]}),event('response_item',message('assistant','third')),event('token_usage_record',{response_id:'third',usage:{input_tokens:30,cached_input_tokens:0,cache_write_input_tokens:0,output_tokens:1}})]));compare();
  fs.writeFileSync(f.files[0],encode(initial('short')));compare();
  fs.writeFileSync(f.files[0]+'.new',encode(initial('atomic replacement')));fs.renameSync(f.files[0]+'.new',f.files[0]);compare();
  const old=fs.readFileSync(f.files[0],'utf8');fs.writeFileSync(f.files[0],old.replace('atomic replacement','edited replacement'));fs.utimesSync(f.files[0],new Date(),new Date(Date.now()+1000));compare();
 }finally{f.close();}
});
test('bounded fork cache preserves inheritance boundaries while parent continues',()=>{
 const f=fixture(),cache=createHistoryCache({maxFiles:1});try{
  const boundary=fs.statSync(f.files[1]).size;
  fs.writeFileSync(f.files[0],encode([event('session_meta',{history_base:{thread_id:ids[1],end_byte_offset:boundary,end_ordinal_exclusive:5}})]));
  const before=readHistory(f.home,ids[0],cache);fs.appendFileSync(f.files[1],encode([event('response_item',message('user','FUTURE_DO_NOT_INHERIT'))]));
  assert.deepEqual(readHistory(f.home,ids[0],cache),before);assert.ok(cache.files.size<=1);
  assert.ok(!JSON.stringify(before).includes('FUTURE_DO_NOT_INHERIT'));
 }finally{f.close();}
});
test('worker reuses tokenizer, avoids rereads, appends only new bytes, and serves distinct chats concurrently',async()=>{
 const f=fixture(),get=createContextStatisticsService(f.home,{cacheMs:0,idleMs:60});try{
  const [first,same,b,c]=await Promise.all([get(ids[0]),get(ids[0]),get(ids[1]),get(ids[2])]);assert.deepEqual(first,same);assert.equal(b.threadId,ids[1]);assert.equal(c.threadId,ids[2]);assert.equal(get.diagnostics().workerStarts,2);
  await get(ids[2]);const before=get.diagnostics().last;assert.equal(before.resultCacheHit,true);
  await get(ids[2]);assert.equal(get.diagnostics().last.history.bytesRead,before.history.bytesRead);
  const append=encode([event('response_item',message('user','fresh increment')),event('response_item',message('assistant','later')),event('token_usage_record',{response_id:'new',usage:{input_tokens:120,cached_input_tokens:100,cache_write_input_tokens:0,output_tokens:1}})]);
  fs.appendFileSync(f.files[2],append);const changed=await get(ids[2]);const after=get.diagnostics().last;assert.equal(after.history.bytesRead-before.history.bytesRead,Buffer.byteLength(append));assert.ok(after.tokens.misses-before.tokens.misses<=3);assert.deepEqual(stable(changed),stable(analyzeContext(f.home,ids[2])));
  const misses=after.tokens.misses;const refreshed=await get(ids[2],true);assert.equal(get.diagnostics().last.tokens.misses,misses);assert.equal(refreshed.generatedAt,changed.generatedAt);
  await new Promise(r=>setTimeout(r,150));assert.equal(get.diagnostics().workers,0);
 }finally{get.close();f.close();}
});
test('failed analysis recovers and closing the service cancels pending work',async()=>{
 const f=fixture(),get=createContextStatisticsService(f.home,{cacheMs:0});try{
  fs.writeFileSync(f.files[0],'invalid json\n');await assert.rejects(get(ids[0]),/解析失败/);
  fs.writeFileSync(f.files[0],encode(initial('recovered')));assert.equal((await get(ids[0])).threadId,ids[0]);
  const pending=get(ids[1]);get.close();await assert.rejects(pending,/已关闭/);await assert.rejects(get(ids[2]),/已关闭/);
 }finally{get.close();f.close();}
});
