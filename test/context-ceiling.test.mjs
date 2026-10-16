import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {EventEmitter} from 'node:events';import {PassThrough} from 'node:stream';
import {ceilingModel,prepareContextCatalog,migrateCeilingPolicy,ceilingConfig,CEILING_RAW_WINDOW} from '../src/context-ceiling.mjs';
import {preflight} from '../src/policy.mjs';import {calculateBudget} from '../src/budget.mjs';import {Bridge} from '../src/bridge.mjs';
const base={slug:'fixture',context_window:500000,max_context_window:872000,effective_context_window_percent:95};
test('all-model ceiling reads back exactly 920K, preserves defaults and caps compaction at 904K',()=>{
 const m=ceilingModel(base);assert.equal(Math.floor(m.max_context_window*m.effective_context_window_percent/100),920000);assert.equal(Math.floor(m.context_window*.9),475000);
 assert.equal(ceilingModel({...base,slug:'gpt-6-astra'}).context_ceiling,920000);
 assert.equal(calculateBudget({usableWindow:920000,compactPercent:98},m).window,CEILING_RAW_WINDOW);
 assert.throws(()=>calculateBudget({usableWindow:921000},m),/920/);
 assert.throws(()=>calculateBudget({usableWindow:920000,compactPercent:99},m),/压缩比例/);
 const p={window:CEILING_RAW_WINDOW,compact:904001,reserve:16000,retainedFloor:0};assert.equal(preflight({},p,m).code,'above_safe_compact');
 const c=ceilingConfig({model_context_window:2000000,model_auto_compact_token_limit:2000000,model_auto_compact_token_limit_scope:'body_after_prefix',unrelated:1});
 assert.equal(c.model_context_window,CEILING_RAW_WINDOW);assert.equal(c.model_auto_compact_token_limit,904000);assert.equal(c.model_auto_compact_token_limit_scope,'total');assert.equal(c.model_post_turn_compact_threshold_percent,100);assert.equal(c.unrelated,1);
});
test('existing visible budgets migrate once, and the native catalog is copied without modifying source',()=>{
 const p={window:736843,compact:630000,reserve:16000,revision:3,enabled:true};const next=migrateCeilingPolicy(p,base);
 assert.equal(Math.floor(next.window*.9),700000);assert.equal(next.compact,630000);assert.equal(next.revision,4);assert.equal(migrateCeilingPolicy(next,base),next);
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ceiling-catalog-'));try{const source=JSON.stringify({models:[{...base,customMetadata:'keep'}]});fs.writeFileSync(path.join(temp,'models_cache.json'),source);const result=prepareContextCatalog({home:temp,control:temp,enabled:true});assert.equal(result.version,1);assert.equal(fs.readFileSync(path.join(temp,'models_cache.json'),'utf8'),source);assert.equal(JSON.parse(fs.readFileSync(result.file)).models[0].customMetadata,'keep');assert.equal(prepareContextCatalog({home:temp,control:temp,enabled:true}).file,result.file);}finally{fs.rmSync(temp,{recursive:true,force:true});}
});
function setup(){const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();const input=new PassThrough(),output=new PassThrough(),writes=[],responses=[];const bridge=new Bridge(child,input,output,async()=>({}),async()=>null,{contextCeiling:1});child.stdin.on('data',d=>writes.push(...d.toString().trim().split('\n').map(JSON.parse)));output.on('data',d=>responses.push(...d.toString().trim().split('\n').map(JSON.parse)));const r=bridge.record('chat');Object.assign(r,{status:'idle',observedWindow:920000,lastUsage:{totalTokens:903990}});return {bridge,r,writes,responses,close(){bridge.frontLines.close();bridge.backLines.close();for(const stream of [input,output,child.stdin,child.stdout])stream.destroy();}};}
const tick=()=>new Promise(r=>setImmediate(r));
test('new input waits for native compaction and updated usage before being sent',async()=>{
 const f=setup();try{f.bridge.fromClient(JSON.stringify({id:1,method:'turn/start',params:{threadId:'chat',input:[{type:'text',text:' a'.repeat(50)}]}}));assert.equal(f.writes.length,1);assert.equal(f.writes[0].method,'thread/compact/start');
 f.bridge.fromServer(JSON.stringify({id:f.writes[0].id,result:{}}));await tick();assert.equal(f.writes.length,1);
 f.bridge.fromServer(JSON.stringify({method:'thread/tokenUsage/updated',params:{threadId:'chat',tokenUsage:{modelContextWindow:920000,last:{totalTokens:1000}}}}));
 f.bridge.fromServer(JSON.stringify({method:'turn/completed',params:{threadId:'chat',turn:{id:'compact'}}}));await tick();assert.equal(f.writes[1].method,'turn/start');assert.equal(f.writes[1].id,1);assert.equal(f.r.locked,false);
 }finally{f.close();}
});
test('compaction failure or oversized retained history blocks the pending model request',async()=>{
 for(const failure of [true,false]){const f=setup();try{f.bridge.fromClient(JSON.stringify({id:7,method:'turn/start',params:{threadId:'chat',input:[{type:'text',text:' a'.repeat(50)}]}}));f.bridge.fromServer(JSON.stringify({id:f.writes[0].id,result:{}}));
 f.bridge.fromServer(JSON.stringify({method:'thread/tokenUsage/updated',params:{threadId:'chat',tokenUsage:{modelContextWindow:920000,last:{totalTokens:919000}}}}));
 f.bridge.fromServer(JSON.stringify({method:'turn/completed',params:{threadId:'chat',turn:{id:'compact',...(failure?{error:{message:'fixture compact failed'}}:{})}}}));await tick();assert.equal(f.writes.length,1);assert.ok(f.responses.find(r=>r.id===7)?.error);assert.equal(f.r.locked,false);
 }finally{f.close();}}
});
test('guard uses the newly applied smaller window before the next server usage update',()=>{
 const f=setup();try{f.r.expectedWindow=100000;f.r.lastUsage={totalTokens:0};f.bridge.fromClient(JSON.stringify({id:9,method:'turn/start',params:{threadId:'chat',input:[{type:'text',text:' a'.repeat(90000)}]}}));assert.equal(f.writes.length,0);assert.ok(f.responses.find(r=>r.id===9)?.error);}finally{f.close();}
});
test('resuming a saved budget injects its rebased window before the first normal request',async()=>{
 const f=setup();try{f.bridge.resolveFork=async()=>({policy:{window:736843,compact:630000,reserve:16000,revision:3,enabled:true},model:base});
 f.bridge.fromClient(JSON.stringify({id:10,method:'thread/resume',params:{threadId:'chat',excludeTurns:true}}));await tick();const request=f.writes.find(x=>x.id===10);assert.equal(Math.floor(request.params.config.model_context_window*.9),700000);assert.equal(request.params.config.model_auto_compact_token_limit,630000);
 f.bridge.fromServer(JSON.stringify({id:10,result:{thread:{id:'chat',status:{type:'idle'}},model:'fixture'}}));await tick();assert.equal(f.r.expectedWindow,700000);assert.equal(f.r.policy.contextCeilingVersion,1);assert.equal(f.r.appliedRevision,4);
 }finally{f.close();}
});
