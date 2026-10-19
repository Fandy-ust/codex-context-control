import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {readHistory,createHistoryCache,analyzeContext,analyzeEvents} from '../src/context-statistics.mjs';
import {historySourcesUnchanged} from '../src/context-history.mjs';
import {createContextStatisticsService} from '../src/context-statistics-service.mjs';
const ids=['11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444'];
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
 const f=fixture(),get=createContextStatisticsService(f.home,{cacheMs:0,idleMs:60000});try{
  const [first,same,b,c]=await Promise.all([get(ids[0]),get(ids[0]),get(ids[1]),get(ids[2])]);assert.deepEqual(first,same);assert.equal(b.threadId,ids[1]);assert.equal(c.threadId,ids[2]);assert.equal(get.diagnostics().workerStarts,2);
  await get(ids[2]);const before=get.diagnostics().last;assert.equal(before.resultCacheHit,true);
  await get(ids[2]);assert.equal(get.diagnostics().last.history.bytesRead,before.history.bytesRead);
  const append=encode([event('response_item',message('user','fresh increment')),event('response_item',message('assistant','later')),event('token_usage_record',{response_id:'new',usage:{input_tokens:120,cached_input_tokens:100,cache_write_input_tokens:0,output_tokens:1}})]);
  fs.appendFileSync(f.files[2],append);const changed=await get(ids[2]);const after=get.diagnostics().last;assert.equal(after.history.bytesRead-before.history.bytesRead,Buffer.byteLength(append));assert.ok(after.tokens.misses-before.tokens.misses<=3);assert.deepEqual(stable(changed),stable(analyzeContext(f.home,ids[2])));
  assert.strictEqual(await get(ids[2]),changed);assert.equal(get.diagnostics().last.resultReused,true);
  const misses=after.tokens.misses;const refreshed=await get(ids[2],true);assert.equal(get.diagnostics().last.tokens.misses,misses);assert.equal(refreshed.generatedAt,changed.generatedAt);
 }finally{get.close();f.close();}
});
test('failed analysis recovers and closing the service cancels pending work',async()=>{
 const f=fixture(),get=createContextStatisticsService(f.home,{cacheMs:0});try{
  fs.writeFileSync(f.files[0],'invalid json\n');await assert.rejects(get(ids[0]),/解析失败/);
  fs.writeFileSync(f.files[0],encode(initial('recovered')));assert.equal((await get(ids[0])).threadId,ids[0]);
  const pending=get(ids[1]);get.close();await assert.rejects(pending,/已关闭/);await assert.rejects(get(ids[2]),/已关闭/);
 }finally{get.close();f.close();}
});

test('idle workers release their memory after the configured idle interval',async()=>{
 const f=fixture(),get=createContextStatisticsService(f.home,{cacheMs:0,idleMs:20});
 try{await get(ids[0]);await new Promise(r=>setTimeout(r,150));assert.equal(get.diagnostics().workers,0);}
 finally{get.close();f.close();}
});

test('statistics affinity reuses a chat cache even after the worker served another chat',async()=>{
 const f=fixture(),get=createContextStatisticsService(f.home,{cacheMs:0,idleMs:60000});
 try{await Promise.all([get(ids[0]),get(ids[1])]);await Promise.all([get(ids[2]),get(ids[3])]);await get(ids[1]);assert.equal(get.diagnostics().last.resultCacheHit,true);assert.equal(get.diagnostics().workerStarts,2);}
 finally{get.close();f.close();}
});

test('result dependencies survive parsed-history eviction and detect file or index changes',()=>{
 const f=fixture(),cache=createHistoryCache({maxBytes:1,maxFiles:1});
 try{
  const first=readHistory(f.home,ids[0],cache);assert.equal(cache.files.size,0);
  assert.equal(historySourcesUnchanged(f.home,first.sources),true);
  fs.appendFileSync(f.files[0],encode([event('response_item',message('user','appended'))]));
  assert.equal(historySourcesUnchanged(f.home,first.sources),false);
  const next=readHistory(f.home,ids[0],cache);assert.equal(historySourcesUnchanged(f.home,next.sources),true);
  const db=new DatabaseSync(path.join(f.home,'state_5.sqlite'));
  try{db.prepare('UPDATE threads SET rollout_path=? WHERE id=?').run(f.files[1],ids[0]);}finally{db.close();}
  assert.equal(historySourcesUnchanged(f.home,next.sources),false);
  assert.equal(historySourcesUnchanged(f.home,[]),false);
 }finally{f.close();}
});

test('repeated chat switching beyond cache capacity stays bounded without cross-chat results',async()=>{
 const f=fixture(),get=createContextStatisticsService(f.home,{cacheMs:0,idleMs:30}),many=Array.from({length:32},(_,i)=>i.toString(16).padStart(8,'0')+'-aaaa-bbbb-cccc-111111111111');
 try{
  const db=new DatabaseSync(path.join(f.home,'state_5.sqlite'));
  try{for(const id of many){const file=path.join(f.home,id+'.jsonl');fs.writeFileSync(file,encode(initial('Unique input '+id)));db.prepare('INSERT INTO threads VALUES(?,?)').run(id,file);}}finally{db.close();}
  for(let cycle=0;cycle<5;cycle++){
   for(let offset=0;offset<many.length;offset+=4){const batch=many.slice(offset,offset+4);const results=await Promise.all(batch.map(id=>get(id)));for(let i=0;i<batch.length;i++)assert.equal(results[i].threadId,batch[i]);const d=get.diagnostics();assert.ok(d.workers<=2&&d.cachedResults<=12);assert.equal(d.pending,0);}
  }
  await new Promise(r=>setTimeout(r,150));assert.equal(get.diagnostics().workers,0);
  const restored=await get(many[0]);assert.deepEqual(stable(restored),stable(analyzeContext(f.home,many[0])));
  assert.ok(get.diagnostics().workerStarts>=3);get.close();assert.equal(get.diagnostics().cachedResults,0);
 }finally{get.close();f.close();}
});


test('speed-only reads share incremental workers without tokenizing text or returning message content',async()=>{
 const f=fixture(),get=createContextStatisticsService(f.home,{cacheMs:0});
 try{
  assert.equal(await get.speed(ids[0]),null);assert.equal(get.diagnostics().last.tokens.misses,0);
  const start=Date.parse('2026-10-16T00:00:01Z'),end='2026-10-16T00:00:03Z';
  fs.appendFileSync(f.files[0],encode([
   {...event('response_item',{...message('assistant','PRIVATE_BODY'),id:'timed'}),timestamp:end},
   {...event('event_msg',{type:'item_completed',item:{type:'AgentMessage',id:'timed'},started_at_ms:start,completed_at_ms:Date.parse(end)}),timestamp:end},
   {...event('token_usage_record',{response_id:'measured',turn_id:'new-turn',usage:{input_tokens:100,output_tokens:300}}),timestamp:end}
  ]));
  const speed=await get.speed(ids[0]);assert.equal(speed.tokensPerSecond,150);assert.equal(speed.responseId,'measured');assert.ok(!JSON.stringify(speed).includes('PRIVATE_BODY'));assert.equal(get.diagnostics().last.tokens.misses,0);
  const before=get.diagnostics().last.history.bytesRead;assert.strictEqual(await get.speed(ids[0]),speed);assert.equal(get.diagnostics().last.history.bytesRead,before);
  const stats=await get(ids[0]);assert.ok(Array.isArray(stats.categories));assert.equal((await get.speed(ids[0])).tokensPerSecond,150);
 }finally{get.close();f.close();}
});
