import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {readHistory,createHistoryCache,historySourcesUnchanged} from '../src/context-history.mjs';
import {activeReasoningEstimate,projectCompensationEvent} from '../src/core/compaction-compensation.mjs';
import {createCompensationManager,createCompensationResolver} from '../src/compaction-compensation.mjs';
import {statisticsEvent} from '../src/statistics-events.mjs';

const chat='11111111-1111-1111-1111-111111111111',revision='22222222-2222-2222-2222-222222222222',latest='33333333-3333-3333-3333-333333333333';
const e=(type,payload)=>({type,payload});
test('projected histories stream past 128 MiB and resume split UTF-8 records',()=>{
 const f=fixture(),cache=createHistoryCache({projectEvent:statisticsEvent});
 try{
  f.db.prepare('UPDATE threads SET rollout_path=? WHERE id=?').run(f.first,chat);
  const bulky=JSON.stringify(e('response_item',{type:'reasoning',encrypted_content:'x'.repeat(1024*1024)}))+'\n';
  for(let i=0;i<129;i++)fs.appendFileSync(f.first,bulky);
  assert.ok(fs.statSync(f.first).size>128*1024*1024);
  const tail=Buffer.from(JSON.stringify(e('response_item',{type:'message',role:'user',content:[{type:'input_text',text:'跨块中文'}]}))+'\n');
  // Split in the middle of a multibyte character; unfinished live tails are
  // reread from the last complete newline when the writer finishes appending.
  const split=tail.indexOf(Buffer.from('中文'))+1;
  fs.appendFileSync(f.first,tail.subarray(0,split));
  const before=readHistory(f.home,chat,cache);
  assert.equal(before.length,132);assert.ok(cache.metrics.retainedBytes<100000);
  assert.throws(()=>readHistory(f.home,chat),/历史大小/);
  fs.appendFileSync(f.first,tail.subarray(split));
  const after=readHistory(f.home,chat,cache);
  assert.equal(after.length,133);assert.equal(after.at(-1).payload.content[0].text,'跨块中文');
  assert.equal(cache.metrics.appendReads,1);
  const bytes=cache.metrics.bytesRead;
  assert.deepEqual(readHistory(f.home,chat,cache),after);assert.equal(cache.metrics.bytesRead,bytes);
 }finally{f.close();}
});
test('older running bridges require a restart before advertising the compensation fixes',()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-compensation-version-'));
 try{
  const manager=createCompensationManager({home,allowExperimental:true});manager.setEnabled(true);
  assert.equal(manager.status([{compensationVersion:1}]).pending,true);
  assert.equal(manager.status([{compensationVersion:3}]).pending,false);
  assert.equal(manager.status([{compensationVersion:3},{compensationVersion:1}]).supportedCount,1);
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
function fixture(){
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-history-revisions-'));
 const dir=path.join(home,'sessions','2026','10','19');fs.mkdirSync(dir,{recursive:true});
 const db=new DatabaseSync(path.join(home,'state_5.sqlite'));db.exec('CREATE TABLE threads(id TEXT PRIMARY KEY,rollout_path TEXT)');
 const write=(id,events)=>{const file=path.join(dir,`rollout-2026-10-19T13-00-00-${id===chat?chat:chat+'_'+id}.jsonl`);fs.writeFileSync(file,events.map(x=>JSON.stringify(x)).join('\n')+'\n');return file;};
 const first=write(chat,[e('session_meta',{id:chat}),e('response_item',{type:'reasoning',id:'kept',encrypted_content:'A'.repeat(16000)}),e('event_msg',{type:'turn_aborted',turn_id:'paused'})]);
 const base={thread_id:chat,end_byte_offset:fs.statSync(first).size,end_ordinal_exclusive:3};
 const second=write(revision,[e('session_meta',{id:chat,history_base:base}),e('response_item',{type:'reasoning',id:'second',encrypted_content:'B'.repeat(24000)}),e('event_msg',{type:'turn_aborted',turn_id:'edited'})]);
 const third=write(latest,[e('session_meta',{id:chat,history_base:{thread_id:revision,end_byte_offset:fs.statSync(second).size,end_ordinal_exclusive:6}})]);
 // Only the chat's current segment has a database row. Earlier rollout IDs do not.
 db.prepare('INSERT INTO threads VALUES(?,?)').run(chat,third);
 return {home,dir,db,first,second,third,base,close(){db.close();fs.rmSync(home,{recursive:true,force:true});}};
}

test('edited chats resolve immutable history segments and preserve owning chat IDs',async()=>{
 const f=fixture(),cache=createHistoryCache({projectEvent:projectCompensationEvent});
 try{
  fs.appendFileSync(f.first,JSON.stringify(e('response_item',{type:'reasoning',id:'excluded',encrypted_content:'C'.repeat(200000)}))+'\n');
  const events=readHistory(f.home,chat,cache);
  assert.equal(events.length,7);assert.ok(events.every(x=>x.originThreadId===chat));
  assert.deepEqual(activeReasoningEstimate(events,{threadId:chat,completedTurnId:'edited'}),{known:true,extraTokens:7176});
  const bytes=cache.metrics.bytesRead;assert.deepEqual(readHistory(f.home,chat,cache),events);assert.equal(cache.metrics.bytesRead,bytes);
  assert.equal(historySourcesUnchanged(f.home,events.sources),true);
  createCompensationManager({home:f.home,allowExperimental:true}).setEnabled(true);
  assert.deepEqual(await createCompensationResolver({home:f.home,control:f.home,allowExperimental:true})({id:chat,turnId:'edited',lastUsage:{totalTokens:393659}}),{enabled:true,known:true,extraTokens:7176});
  fs.appendFileSync(f.second,JSON.stringify(e('event_msg',{type:'turn_aborted',turn_id:'later'}))+'\n');
  assert.equal(historySourcesUnchanged(f.home,events.sources),false);
  assert.deepEqual(activeReasoningEstimate(readHistory(f.home,chat,cache),{threadId:chat,completedTurnId:'edited'}),{known:true,extraTokens:7176});
  f.db.prepare('UPDATE threads SET rollout_path=? WHERE id=?').run(f.second,chat);
  assert.equal(historySourcesUnchanged(f.home,events.sources),false);
 }finally{f.close();}
});

test('revision lookup rejects ambiguous files, cycles, and invalid inheritance boundaries',()=>{
 const f=fixture();try{
  const duplicate=path.join(f.dir,`rollout-duplicate_${revision}.jsonl`);fs.copyFileSync(f.second,duplicate);
  assert.throws(()=>readHistory(f.home,chat),/唯一定位/);fs.unlinkSync(duplicate);
  const encode=p=>JSON.stringify(e('session_meta',{id:chat,history_base:p}))+'\n';
  fs.writeFileSync(f.third,encode({thread_id:revision,end_byte_offset:fs.statSync(f.second).size,end_ordinal_exclusive:999}));
  assert.throws(()=>readHistory(f.home,chat),/边界不一致/);
  fs.writeFileSync(f.third,encode({thread_id:revision,end_byte_offset:fs.statSync(f.second).size-1,end_ordinal_exclusive:6}));
  assert.throws(()=>readHistory(f.home,chat),/完整记录/);
  fs.writeFileSync(f.third,encode({thread_id:latest,end_byte_offset:0,end_ordinal_exclusive:0}));
  assert.throws(()=>readHistory(f.home,chat),/继承历史异常/);
 }finally{f.close();}
});
