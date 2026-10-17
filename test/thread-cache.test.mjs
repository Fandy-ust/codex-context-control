import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {ThreadCache} from '../src/thread-cache.mjs';
const event=(tokens,window=920000)=>JSON.stringify({type:'event_msg',timestamp:new Date().toISOString(),payload:{type:'token_count',info:{last_token_usage:{total_tokens:tokens},total_token_usage:{total_tokens:99999999},model_context_window:window}}})+'\n';
function fixture(){const home=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-summary-'));const file=path.join(home,'history.jsonl'),cacheFile=path.join(home,'cache.json');return {home,file,cacheFile,row:{id:'chat',rollout_path:file},cache:new ThreadCache({home,file:cacheFile}),close(){fs.rmSync(home,{recursive:true,force:true});}};}
test('cache survives restart, skips unchanged files, and reads only complete appended records',async()=>{
 const f=fixture();try{
 fs.writeFileSync(f.file,JSON.stringify({type:'response_item',payload:{text:'PRIVATE_TEXT'}})+'\n'+event(123));await f.cache.scan([f.row]);assert.equal(f.cache.get('chat').lastUsage.totalTokens,123);assert.ok(!fs.readFileSync(f.cacheFile,'utf8').includes('PRIVATE_TEXT'));
 const restart=new ThreadCache({home:f.home,file:f.cacheFile});await restart.scan([f.row]);assert.equal(restart.metrics.bytesRead,0);assert.equal(restart.metrics.hits,1);
 const next=event(456);fs.appendFileSync(f.file,next.slice(0,40));await restart.scan([f.row]);assert.equal(restart.get('chat').lastUsage.totalTokens,123);
 fs.appendFileSync(f.file,next.slice(40));await restart.scan([f.row]);assert.equal(restart.get('chat').lastUsage.totalTokens,456);assert.ok(restart.metrics.bytesRead<next.length*2);
 }finally{f.close();}
});
test('tail reads are bounded; replacements and compactions invalidate previous observations',async()=>{
 const f=fixture();try{
 fs.writeFileSync(f.file,JSON.stringify({type:'response_item',payload:{text:'x'.repeat(1024*1024)}})+'\n'+event(500));await f.cache.scan([f.row]);assert.ok(f.cache.metrics.bytesRead<=256*1024);assert.equal(f.cache.get('chat').lastUsage.totalTokens,500);
 fs.appendFileSync(f.file,JSON.stringify({type:'compacted',timestamp:new Date().toISOString(),payload:{}})+'\n');await f.cache.scan([f.row]);assert.equal(f.cache.get('chat').lastUsage,null);
 fs.writeFileSync(f.file,event(12,400000));await f.cache.scan([f.row]);assert.equal(f.cache.get('chat').observedWindow,400000);assert.equal(f.cache.get('chat').lastUsage.totalTokens,12);
 }finally{f.close();}
});
test('out-of-home logs and managed chats are not scanned',async()=>{
 const f=fixture(),other=fixture();try{fs.writeFileSync(other.file,event(99));await f.cache.scan([{id:'outside',rollout_path:other.file}]);assert.equal(f.cache.get('outside'),null);fs.writeFileSync(f.file,event(100));await f.cache.scan([{...f.row,thread_source:'agent'}]);assert.equal(f.cache.get('chat'),null);}finally{f.close();other.close();}
});
