import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {DatabaseSync} from 'node:sqlite';
import {statisticsEvent} from '../src/statistics-events.mjs';import {readHistory,createHistoryCache} from '../src/context-history.mjs';import {analyzeEvents,analyzeContext} from '../src/context-statistics.mjs';
const id='11111111-1111-1111-1111-111111111111';
const e=(type,payload,second=0)=>({type,payload,originThreadId:id,timestamp:`2026-10-17T00:00:${String(second).padStart(2,'0')}.000Z`});
const message=(role,text,other={})=>({type:'message',role,content:[{type:'input_text',text}],...other});
const usage=n=>({response_id:'r'+n,turn_id:'turn',usage:{input_tokens:1000,cached_input_tokens:800,cache_write_input_tokens:0,output_tokens:20,reasoning_output_tokens:10}});
const stable=x=>{const {generatedAt,...rest}=x;return rest;};
function events(){return [
 e('session_meta',{base_instructions:{text:'Base'},history_base:undefined}),
 e('turn_context',{turn_id:'turn',model:'gpt-6-astra',service_tier:'priority',effort:'high'}),
 e('event_msg',{type:'task_started',turn_id:'turn',model_context_window:920000}),
 e('event_msg',{type:'token_count',info:{model_context_window:920000,total_token_usage:{input_tokens:123}}}),
 e('response_item',message('developer','developer')),
 e('response_item',message('user','first',{id:'u1'})),
 e('response_item',{type:'function_call_output',output:[{type:'input_text',text:'tool result'},{type:'input_image',image_url:'PRIVATE_IMAGE'}]}),
 e('response_item',{type:'reasoning',id:'thought1',summary:[{text:'PRIVATE_THOUGHT'}],encrypted_content:'PRIVATE_ENCRYPTED'},1),
 e('event_msg',{type:'item_completed',item:{id:'thought1',type:'Reasoning',text:'PRIVATE_THOUGHT'},started_at_ms:Date.parse('2026-10-17T00:00:00Z'),completed_at_ms:Date.parse('2026-10-17T00:00:01Z')},1),
 e('response_item',{type:'function_call',id:'call1',namespace:'tools',name:'test',arguments:'{"x":1}'},1),
 e('token_usage_record',usage(1),2),
 e('event_msg',{type:'thread_settings_applied',thread_settings:{model:'gpt-6-sol',reasoning_effort:'medium',service_tier:'default'}}),
 e('response_item',message('user','steer',{id:'u2',internal_chat_message_metadata_passthrough:{turn_id:'turn',content_item_kinds:['user.text']}}),3),
 e('response_item',{type:'custom_tool_call',id:'call2',name:'exec',input:'some code'}),
 e('response_item',{type:'custom_tool_call_output',output:'result'}),
 e('response_item',{type:'future_opaque',id:'opaque',encrypted_content:'PRIVATE_UNKNOWN'}),
 e('response_item',message('assistant','Done',{id:'a2',channel:'final_answer'}),4),
 e('token_usage_record',usage(2),5)
];}

test('statistics projection preserves every statistic and strips unused private payloads',()=>{
 const source=events();
 for(let n=1;n<=source.length;n++)assert.deepEqual(stable(analyzeEvents(source.slice(0,n),id)),stable(analyzeEvents(source.slice(0,n).map(statisticsEvent),id)));
 const replacement=[message('user','summary',{internal_chat_message_metadata_passthrough:{content_item_kinds:['compaction.summary']}}),{type:'context_compaction',encrypted_content:'PRIVATE_COMPACT'},message('user','question'),{type:'reasoning',encrypted_content:'PRIVATE_RETAINED'}];
 source.push(e('compacted',{message:'summary',window_id:'window',compaction_response_id:'r2',replacement_history:replacement},6));
 source.push(e('response_item',message('assistant','later',{phase:'final'}),7),e('token_usage_record',usage(3),8));
 assert.deepEqual(stable(analyzeEvents(source,id)),stable(analyzeEvents(source.map(statisticsEvent),id)));
 assert.ok(!JSON.stringify(source.map(statisticsEvent)).includes('PRIVATE_'));
 for(const type of ['thread_rolled_back','thread_rollback'])assert.throws(()=>analyzeEvents([...source,e('event_msg',{type})].map(statisticsEvent),id),/回退/);
});

test('projected cache retains useful events within its budget and reads only appended bytes',()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-projection-')),file=path.join(home,`rollout-${id}.jsonl`),db=new DatabaseSync(path.join(home,'state_5.sqlite'));
 db.exec('CREATE TABLE threads(id TEXT PRIMARY KEY,rollout_path TEXT)');db.prepare('INSERT INTO threads VALUES(?,?)').run(id,file);db.close();
 const source=events();source[7].payload.encrypted_content='opaque'.repeat(400000);
 source.push(e('event_msg',{type:'item_completed',item:{type:'CommandExecution',aggregated_output:'duplicated'.repeat(200000)}}));
 const encode=rows=>rows.map(row=>JSON.stringify(row)).join('\n')+'\n';fs.writeFileSync(file,encode(source));
 const cache=createHistoryCache({maxBytes:65536,projectEvent:statisticsEvent});
 try{
  const first=readHistory(home,id,cache);assert.equal(cache.files.size,1);assert.ok([...cache.files.values()][0].retainedBytes<65536);
  assert.deepEqual(stable(analyzeEvents(first,id)),stable(analyzeContext(home,id)));
  const before=cache.metrics.bytesRead;const append=encode([e('response_item',message('user','new input'),9),e('response_item',message('assistant','new output',{phase:'final'}),10),e('token_usage_record',usage(4),11)]);
  fs.appendFileSync(file,append);const changed=readHistory(home,id,cache);
  assert.equal(cache.metrics.bytesRead-before,Buffer.byteLength(append));assert.equal(cache.metrics.appendReads,1);
  assert.deepEqual(stable(analyzeEvents(changed,id)),stable(analyzeContext(home,id)));
  const child='22222222-2222-2222-2222-222222222222',childFile=path.join(home,'fork.jsonl'),boundary=fs.statSync(file).size;
  fs.writeFileSync(childFile,encode([e('session_meta',{history_base:{thread_id:id,end_byte_offset:boundary,end_ordinal_exclusive:source.length+3}})]));
  const index=new DatabaseSync(path.join(home,'state_5.sqlite'));index.prepare('INSERT INTO threads VALUES(?,?)').run(child,childFile);index.close();
  const inherited=readHistory(home,child,cache);assert.equal(inherited.length,source.length+4);
  fs.appendFileSync(file,encode([e('response_item',message('user','future parent input'),12)]));
  assert.deepEqual(stable(analyzeEvents(readHistory(home,child,cache),child)),stable(analyzeContext(home,child)));
  assert.ok(!JSON.stringify(readHistory(home,child,cache)).includes('future parent input'));
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
