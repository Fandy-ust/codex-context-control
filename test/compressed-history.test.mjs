import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {zstdCompressSync} from 'node:zlib';import {DatabaseSync} from 'node:sqlite';
import {readHistory,createHistoryCache,historySourcesUnchanged} from '../src/context-history.mjs';
import {randomBytes} from 'node:crypto';
import {statisticsEvent} from '../src/statistics-events.mjs';import {createContextStatisticsService} from '../src/context-statistics-service.mjs';import {ThreadCache} from '../src/thread-cache.mjs';import {readForkParent} from '../src/fork-metadata.mjs';
const parent='11111111-1111-1111-1111-111111111111',child='22222222-2222-2222-2222-222222222222';
const event=(type,payload)=>({type,payload});const encode=items=>items.map(e=>JSON.stringify(e)).join('\n')+'\n';
function fixture(){
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-compressed-')),dir=path.join(home,'sessions');fs.mkdirSync(dir);
 const db=new DatabaseSync(path.join(home,'state_5.sqlite'));db.exec('CREATE TABLE threads(id TEXT PRIMARY KEY,rollout_path TEXT)');
 const source=path.join(dir,'rollout-'+parent+'.jsonl'),fork=path.join(dir,'rollout-'+child+'.jsonl');
 const data=encode([event('session_meta',{id:parent}),event('turn_context',{model:'fixture'}),event('response_item',{type:'message',role:'user',content:[{type:'input_text',text:'PRIVATE_BODY 中文'}]}),event('event_msg',{type:'token_count',info:{last_token_usage:{total_tokens:120},model_context_window:500000}}),event('event_msg',{type:'task_complete'})]);
 fs.writeFileSync(source+'.zst',zstdCompressSync(Buffer.from(data)));db.prepare('INSERT INTO threads VALUES(?,?)').run(parent,source);
 fs.writeFileSync(fork,encode([event('session_meta',{id:child,forked_from_id:parent,history_base:{thread_id:parent,end_byte_offset:Buffer.byteLength(data),end_ordinal_exclusive:5}})]));db.prepare('INSERT INTO threads VALUES(?,?)').run(child,fork);
 return {home,db,source,fork,data,close(){db.close();fs.rmSync(home,{recursive:true,force:true});}};
}
test('compressed root and inherited prefixes read exactly, cache unchanged bytes, and survive both representation transitions',()=>{
 const f=fixture(),cache=createHistoryCache({projectEvent:statisticsEvent});try{
  const initial=readHistory(f.home,child,cache);assert.equal(initial.length,6);assert.equal(initial[2].payload.content[0].text,'PRIVATE_BODY 中文');
  const bytes=cache.metrics.bytesRead;assert.deepEqual(readHistory(f.home,child,cache),initial);assert.equal(cache.metrics.bytesRead,bytes);assert.equal(historySourcesUnchanged(f.home,initial.sources),true);
  fs.writeFileSync(f.source,f.data);assert.equal(historySourcesUnchanged(f.home,initial.sources),false);
  assert.deepEqual(readHistory(f.home,child,cache),initial,'plain and compressed siblings are one logical rollout');
  fs.unlinkSync(f.source+'.zst');fs.appendFileSync(f.source,encode([event('response_item',{type:'message',role:'user',content:'FUTURE_NOT_INHERITED'})]));assert.deepEqual(readHistory(f.home,child,cache),initial);
  fs.writeFileSync(f.source+'.zst',zstdCompressSync(fs.readFileSync(f.source)));fs.unlinkSync(f.source);assert.deepEqual(readHistory(f.home,child,cache),initial);
  assert.ok(!fs.existsSync(f.source),'reader never materializes the source in Codex home');
 }finally{f.close();}
});
test('streaming preserves compressed blocks spanning multiple input reads',()=>{
 const f=fixture();try{
  const text=randomBytes(400000).toString('base64'),data=f.data+encode([event('response_item',{type:'message',role:'user',content:[{type:'input_text',text}]})]);
  const compressed=zstdCompressSync(Buffer.from(data));assert.ok(compressed.length>4*65536);fs.writeFileSync(f.source+'.zst',compressed);
  assert.equal(readHistory(f.home,parent).at(-1).payload.content[0].text,text);
 }finally{f.close();}
});
test('missing, duplicate, corrupt and invalid compressed inheritance have distinct failures',()=>{
 const f=fixture();try{
  f.db.prepare('DELETE FROM threads WHERE id=?').run(parent);
  const original=fs.readFileSync(f.source+'.zst');fs.writeFileSync(f.source+'.zst','bad zstd');assert.throws(()=>readHistory(f.home,child),/解压失败/);
  fs.unlinkSync(f.source+'.zst');assert.throws(()=>readHistory(f.home,child),/继承历史文件不存在/);
  fs.writeFileSync(f.source+'.zst',original);const other=path.join(f.home,'sessions','duplicate-'+parent+'.jsonl.zst');fs.writeFileSync(other,original);assert.throws(()=>readHistory(f.home,child),/多份不同/);fs.unlinkSync(other);
  fs.writeFileSync(f.fork,encode([event('session_meta',{id:child,history_base:{thread_id:parent,end_byte_offset:Buffer.byteLength(f.data)-1,end_ordinal_exclusive:5}})]));assert.throws(()=>readHistory(f.home,child),/完整记录/);
 }finally{f.close();}
});
test('selected compressed observations are numeric, inherited, reusable and invalidate on new input or interruption',async()=>{
 const f=fixture(),get=createContextStatisticsService(f.home,{cacheMs:0});try{
  const first=await get.observation(child);assert.equal(first.known,true);assert.deepEqual(first.lastUsage,{totalTokens:120});assert.ok(!JSON.stringify(first).includes('PRIVATE_BODY'));assert.equal(get.diagnostics().last.tokens.misses,0);
  await get.observation(child);assert.equal(get.diagnostics().last.resultCacheHit,true);
  const bytes=get.diagnostics().last.history.bytesRead;await Promise.all([get.observation(child),get.speed(child)]);assert.equal(get.diagnostics().last.history.bytesRead,bytes);assert.equal(get.diagnostics().workerStarts,1);
  fs.appendFileSync(f.fork,encode([event('event_msg',{type:'task_started'}),event('response_item',{type:'message',role:'user',content:'new'}),event('event_msg',{type:'turn_aborted'})]));assert.equal((await get.observation(child)).known,false);
 }finally{get.close();f.close();}
});
test('cold discovery skips decompression; explicit tails and fork headers support compressed records',async()=>{
 const f=fixture(),cache=new ThreadCache({home:f.home,file:path.join(f.home,'cache.json')});try{
  const row={id:parent,rollout_path:f.source};await cache.scan([row]);assert.equal(cache.metrics.bytesRead,0);
  await cache.scan([row],{includeCompressed:true});assert.equal(cache.get(parent).lastUsage.totalTokens,120);
  const bytes=cache.metrics.bytesRead;await cache.scan([row],{includeCompressed:true});assert.equal(cache.metrics.bytesRead,bytes);
  fs.writeFileSync(f.fork+'.zst',zstdCompressSync(fs.readFileSync(f.fork)));fs.unlinkSync(f.fork);
  assert.equal(readForkParent(f.home,child,f.fork,new Map()),null);
  assert.equal(readForkParent(f.home,child,f.fork,new Map(),{includeCompressed:true}),parent);
 }finally{f.close();}
});
