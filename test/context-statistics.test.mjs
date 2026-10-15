import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {readHistory,selectRequestSnapshot,summarizeSnapshot,responseTimeline,buildTimeline,analyzeContext} from '../src/context-statistics.mjs';
import {createContextStatisticsService} from '../src/context-statistics-service.mjs';
const id='11111111-1111-1111-1111-111111111111',parent='22222222-2222-2222-2222-222222222222';
const e=(type,payload,ms=0,originThreadId=id)=>({type,payload,timestamp:new Date(1700000000000+ms).toISOString(),originThreadId});
const msg=(role,text,extra={})=>({type:'message',role,content:[{type:'input_text',text}],...extra});
function fixture(){
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'context-statistics-'));
 const db=new DatabaseSync(path.join(home,'state_5.sqlite'));db.exec('CREATE TABLE threads(id TEXT,rollout_path TEXT)');
 const write=(key,events)=>{const file=path.join(home,key+'.jsonl');fs.writeFileSync(file,events.map(x=>JSON.stringify(x)).join('\n')+'\n');db.prepare('INSERT INTO threads VALUES(?,?)').run(key,file);return file;};
 return {home,db,write,close(){db.close();fs.rmSync(home,{recursive:true,force:true});}};
}
test('fork uses authoritative byte and ordinal limits, not all parent events',()=>{
 const f=fixture();try{
  const original=[e('session_meta',{},0,parent),e('response_item',msg('user','inherited'),1,parent)];
  const file=f.write(parent,original),boundary=fs.statSync(file).size;
  fs.appendFileSync(file,JSON.stringify(e('response_item',msg('user','future'),2,parent))+'\n');
  f.write(id,[e('session_meta',{history_base:{thread_id:parent,end_byte_offset:boundary,end_ordinal_exclusive:2}}),e('response_item',msg('user','own'))]);
  const events=readHistory(f.home,id);assert.equal(events.length,4);assert.equal(events[1].originThreadId,parent);assert.ok(!JSON.stringify(events).includes('future'));
  fs.writeFileSync(path.join(f.home,id+'.jsonl'),JSON.stringify(e('session_meta',{history_base:{thread_id:parent,end_byte_offset:boundary-1,end_ordinal_exclusive:2}}))+'\n');
  assert.throws(()=>readHistory(f.home,id),/边界/);
 }finally{f.close();}
});
test('snapshot matches input before generated response, not response outputs or later tools',()=>{
 const events=[e('session_meta',{base_instructions:{text:'base'}}),e('response_item',msg('user','question')),e('response_item',{type:'reasoning',id:'r1',encrypted_content:'SECRET'}),e('response_item',{type:'custom_tool_call',name:'exec',input:'code'}),e('token_usage_record',{response_id:'a',usage:{input_tokens:100}}),e('response_item',{type:'custom_tool_call_output',output:'answer'}),e('response_item',msg('assistant','final',{phase:'final'})),e('token_usage_record',{response_id:'b',usage:{input_tokens:130}}),e('response_item',{type:'custom_tool_call_output',output:'later'})];
 const s=selectRequestSnapshot(events,id);assert.equal(s.history.length,4);assert.equal(s.usage.input_tokens,130);assert.equal(s.history.at(-1).output,'answer');assert.equal(s.responseCount,1);
 const reset=selectRequestSnapshot([...events,e('compacted',{message:'text summary',replacement_history:[msg('user','text summary')]})],id);
 assert.equal(reset.snapshotKind,'local_history');assert.equal(reset.history.length,1);assert.equal(reset.usage,null);
});
test('text summary once; encrypted payload never tokenized/exported; negative residual not zero',()=>{
 const calls=[];const snapshot={history:[msg('user','summary',{internal_chat_message_metadata_passthrough:{content_item_kinds:['compaction.summary']}}),msg('user','choice',{internal_chat_message_metadata_passthrough:{content_item_kinds:['user.message']}}),{type:'reasoning',encrypted_content:'SECRET'},{type:'compaction',encrypted_content:'CIPHER'},{type:'custom_tool_call',name:'exec',input:'code'},{type:'custom_tool_call_output',output:[{type:'input_image',image_url:'PRIVATE_IMAGE'},{type:'input_text',text:'result'}]}],base:'base',summary:'summary',usage:{input_tokens:100,cached_input_tokens:50},snapshotKind:'last_request'};
 const out=summarizeSnapshot(snapshot,id,text=>{calls.push(text);return text.length;});
 assert.equal(out.plaintextSummaryItems,1);assert.equal(out.categories.find(x=>x.category==='user').items,1);assert.equal(out.unclassified.opaqueItems,2);assert.equal(out.unclassified.images,1);assert.equal(out.cachedInputTokens,50);
 assert.equal(calls.filter(x=>x==='summary').length,1);assert.ok(!JSON.stringify(out).includes('SECRET'));assert.ok(!calls.join('').includes('CIPHER'));assert.equal(out.toolCalls[0].count,1);
 assert.equal(summarizeSnapshot({...snapshot,usage:{input_tokens:1}},id,t=>t.length).unclassified.tokensEstimate,null);
});
test('response speed excludes tool execution, preserves missing timing and historical config/cache',()=>{
 const events=[e('turn_context',{model:'model-a',effort:'high'}),e('event_msg',{type:'task_started',model_context_window:363000}),e('event_msg',{type:'thread_settings_applied',thread_settings:{service_tier:'priority'}}),e('event_msg',{type:'item_completed',item:{id:'r',type:'Reasoning'},started_at_ms:1700000001000,completed_at_ms:1700000002000},2000),e('response_item',{type:'reasoning',id:'r'},2000),e('response_item',{type:'custom_tool_call',id:'c',name:'exec'},2900),e('token_usage_record',{response_id:'a',turn_id:'t',usage:{input_tokens:100,cached_input_tokens:80,output_tokens:100,reasoning_output_tokens:30}},3000),e('event_msg',{type:'item_completed',item:{id:'tool',type:'CommandExecution'},started_at_ms:1700000003000,completed_at_ms:1700000099000},99000),e('turn_context',{model:'model-b',effort:'low'},100000),e('response_item',{type:'custom_tool_call',id:'c2'},101000),e('token_usage_record',{response_id:'b',usage:{input_tokens:130,cached_input_tokens:70,output_tokens:10}},102000)];
 const points=responseTimeline(events,id);assert.equal(points.length,2);assert.equal(points[0].durationMs,2000);assert.equal(points[0].tokensPerSecond,50);assert.equal(points[0].cacheHitRate,.8);assert.equal(points[0].config.model,'model-a');assert.equal(points[0].config.contextWindow,363000);assert.equal(points[1].config.model,'model-b');assert.equal(points[1].tokensPerSecond,null);assert.equal(points[1].cacheDelta,-10);
 assert.equal(responseTimeline([...events,events.at(-1)],id).length,2);assert.equal(responseTimeline(events,parent).length,0);
});
test('offline tokenizer and worker return aggregates; cache is per chat and refreshable',async()=>{
 const f=fixture();try{
  const file=f.write(id,[e('session_meta',{}),e('response_item',msg('user','hello world')),e('response_item',msg('assistant','hi',{phase:'final'})),e('token_usage_record',{response_id:'a',usage:{input_tokens:10,output_tokens:1,cached_input_tokens:2}})]);
  const out=analyzeContext(f.home,id);assert.equal(out.visibleTokens,2);assert.equal(out.responses.length,1);assert.ok(!JSON.stringify(out).includes('hello world'));
  const service=createContextStatisticsService(f.home),first=await service(id);fs.appendFileSync(file,JSON.stringify(e('compacted',{message:'summary',replacement_history:[msg('user','summary')]}))+'\n');
  assert.deepEqual(await service(id),first);assert.equal((await service(id,true)).snapshotKind,'local_history');await assert.rejects(service(parent),/尚无本地历史/);
 }finally{f.close();}
});

test('timeline preserves user steers separately from tool outputs and colors only confirmed compaction responses',()=>{
 const user=(text,mid,turn='turn-a',kind='user.text')=>msg('user',text,{id:mid,internal_chat_message_metadata_passthrough:{turn_id:turn,content_item_kinds:[kind]}});
 const events=[e('turn_context',{turn_id:'turn-a',model:'model-a'}),
  e('response_item',user('PRIVATE_FIRST_INPUT','u1')),
  e('event_msg',{type:'item_completed',item:{type:'UserMessage',id:'ui-u1'}}),
  e('response_item',{type:'custom_tool_call',id:'call',name:'exec'}),
  e('token_usage_record',{response_id:'response-a',turn_id:'turn-a',usage:{input_tokens:100,output_tokens:15}},10),
  e('response_item',{type:'custom_tool_call_output',output:'PRIVATE_TOOL_RESULT'},11),
  e('response_item',user('PRIVATE_STEER','u2'),12),
  e('response_item',user('PRIVATE_STEER','u2'),12),
  e('response_item',user('environment','env','turn-a','environments.environment_context'),13),
  e('response_item',user('summary','summary','turn-a','compaction.summary'),13),
  e('token_usage_record',{response_id:'unlinked',usage:{input_tokens:110,output_tokens:4}},14),
  e('token_usage_record',{response_id:'compression-response',usage:{input_tokens:120,output_tokens:10}},15),
  e('compacted',{window_id:'window2',compaction_response_id:'compression-response',replacement_history:[user('summary','retained','turn-a','compaction.summary')]},16),
  e('event_msg',{type:'item_completed',item:{type:'ContextCompaction'}},16),
  e('response_item',msg('assistant','done',{id:'final',phase:'final'}),18),
  e('token_usage_record',{response_id:'response-final',turn_id:'turn-a',usage:{input_tokens:50,output_tokens:5}},19),
  e('turn_context',{turn_id:'turn-b',model:'model-b'},20),
  e('response_item',user('next user input','u3','turn-b'),21)];
 const out=buildTimeline(events,id,t=>t.length);
 assert.deepEqual(out.timelineEvents.map(x=>x.eventType),['user_input','steering','compaction','user_input']);
 assert.deepEqual(out.responses.map(x=>x.eventType),['intermediate','intermediate','compaction','final']);
 assert.equal(out.timelineEvents[1].tokensEstimate,'PRIVATE_STEER'.length);
 assert.equal(out.timelineEvents[2].retainedItems,1);
 assert.ok(out.responses[0].position<out.timelineEvents[1].position);
 assert.ok(out.timelineEvents[1].position<out.responses.at(-1).position);
 assert.equal(new Set([...out.responses,...out.timelineEvents].map(x=>x.position)).size,8);
 assert.ok(!JSON.stringify(out).includes('PRIVATE_'));
 assert.equal(out.responses.find(x=>x.id==='unlinked').kind,'未关联响应');
});

test('missing cache stays unknown and breaks chart series; logged zero stays distinguishable',()=>{
 const events=[e('token_usage_record',{response_id:'a',usage:{input_tokens:100,cached_input_tokens:80}},1),e('token_usage_record',{response_id:'b',usage:{input_tokens:100}},2),e('token_usage_record',{response_id:'c',usage:{input_tokens:100,cached_input_tokens:0}},3),e('token_usage_record',{response_id:'d',usage:{input_tokens:100,cached_input_tokens:101}},4)];
 const rows=buildTimeline(events,id).responses;
 assert.equal(rows[1].cachedInputTokens,null);assert.equal(rows[1].cacheStatus,'missing');
 assert.notEqual(rows[0].cacheSegment,rows[2].cacheSegment);assert.equal(rows[2].cacheDelta,null);
 assert.equal(rows[2].cachedInputTokens,0);assert.equal(rows[2].cacheStatus,'zero_in_log');assert.equal(rows[3].cachedInputTokens,null);assert.equal(rows[3].cacheStatus,'invalid');
});
test('generation rate excludes the separately identified pre-generation gap; reversed timing is rejected',()=>{
 const events=[e('response_item',{type:'custom_tool_call_output',output:'ready'},1000),e('event_msg',{type:'item_completed',item:{id:'r',type:'Reasoning'},started_at_ms:1700000009000,completed_at_ms:1700000010000},10000),e('response_item',{type:'reasoning',id:'r'},10000),e('token_usage_record',{response_id:'a',usage:{input_tokens:100,cached_input_tokens:0,output_tokens:500}},14000)];
 const r=buildTimeline(events,id).responses[0];assert.equal(r.durationMs,5000);assert.equal(r.preGenerationGapMs,8000);assert.equal(r.recordToCompletionMs,13000);assert.equal(r.tokensPerSecond,100);
 const invalid=[...events.slice(0,3),e('token_usage_record',{response_id:'a',usage:{output_tokens:500}},9500)];assert.equal(buildTimeline(invalid,id).responses[0].tokensPerSecond,null);
});
