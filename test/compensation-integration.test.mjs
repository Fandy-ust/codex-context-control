import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import readline from 'node:readline';
import {spawn} from 'node:child_process';
import {PassThrough} from 'node:stream';
import {Bridge} from '../src/bridge.mjs';
import {createCompensationResolver,createCompensationManager} from '../src/compaction-compensation.mjs';
const binary=process.env.CONTEXT_CONTROL_TEST_CODEX||'/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex';
const baseModel={slug:'context-fixture',max_context_window:872000,effective_context_window_percent:95};
const policy={window:63158,compact:40000,reserve:16000,retainedFloor:0,scope:'total',revision:1,enabled:true,effectivePercent:95};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function scenario(enabled,interrupt=false,{smallCatalog=false,high=false,ceiling=false}={}){
 const model={...baseModel,...(smallCatalog?{max_context_window:66000}:{}),...(ceiling?{max_context_window:1022223,effective_context_window_percent:90}:{})};
 const realPolicy=ceiling?{...policy,window:1022223,compact:900000,reserve:20000,effectivePercent:90}:policy;
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-compensate-')),home=path.join(temp,'codex'),control=path.join(temp,'control');fs.mkdirSync(home);fs.mkdirSync(control);
 const manager=createCompensationManager({home:control,allowExperimental:true});manager.setEnabled(enabled);
 const catalog=path.join(home,'models.json');const catalogData=JSON.parse(fs.readFileSync(new URL('./fixtures/models.json',import.meta.url)));Object.assign(catalogData.models[0],{max_context_window:enabled?16000000:model.max_context_window,effective_context_window_percent:model.effective_context_window_percent});fs.writeFileSync(catalog,JSON.stringify(catalogData));
 const requests=[];let child,bridge,sequence=0,holdNext=false;const events=[],pending=new Map(),input=new PassThrough(),output=new PassThrough();let stderr='';
 const server=http.createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;requests.push(JSON.parse(body));const n=requests.length;
  if(holdNext){holdNext=false;res.writeHead(200,{'content-type':'text/event-stream'});res.flushHeaders();return;}
  const items=[{id:'rs_'+n,type:'reasoning',summary:[],encrypted_content:'A'.repeat(ceiling?2667534:200000)},{id:'m_'+n,type:'message',role:'assistant',status:'completed',phase:'final',content:[{type:'output_text',text:'OK',annotations:[]}]}];
  const usage=ceiling?(n<3?800000:n===3?900000:10000):high&&n===2?45000:10000;
  const stream=[{type:'response.created',response:{id:'r_'+n,object:'response',status:'in_progress',output:[]}},...items.flatMap((item,i)=>[{type:'response.output_item.added',output_index:i,item},{type:'response.output_item.done',output_index:i,item}]),{type:'response.completed',response:{id:'r_'+n,object:'response',status:'completed',output:items,usage:{input_tokens:usage,output_tokens:10,total_tokens:usage+10,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:8}}}}];
  res.writeHead(200,{'content-type':'text/event-stream',...(high?{'x-reasoning-included':'true'}:{})});res.end(stream.map(e=>`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''));
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 fs.writeFileSync(path.join(home,'config.toml'),`model="context-fixture"\nmodel_provider="fixture"\nmodel_catalog_json=${JSON.stringify(catalog)}\n[features]\nplugins=false\n[analytics]\nenabled=false\n[feedback]\nenabled=false\n[model_providers.fixture]\nname="Local test"\nbase_url="http://127.0.0.1:${server.address().port}/v1"\nwire_api="responses"\nrequires_openai_auth=false\nsupports_websockets=false\n`);
 const call=(method,params)=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error(method+' timeout '+stderr.slice(-500)));},15000);pending.set(id,{resolve,reject,timer});input.write(JSON.stringify({id,method,params})+'\n');});
 try{
  child=spawn(binary,['app-server','--listen','stdio://'],{cwd:temp,env:{PATH:process.env.PATH,HOME:temp,TMPDIR:temp,CODEX_HOME:home},stdio:['pipe','pipe','pipe']});child.stderr.on('data',d=>stderr+=d.toString());
  bridge=new Bridge(child,input,output,async()=>({model}),async id=>({policy:bridge.records.get(id)?.policy,model}),{accountingWindowLimit:enabled?16000000:null,nativeBudgetSupport:true,resolveNewChatBudget:async()=>({policy:interrupt?{...policy,window:700000,compact:600000,revision:0}:realPolicy}),resolveCompensation:createCompensationResolver({home,control,allowExperimental:true})});
  readline.createInterface({input:output}).on('line',line=>{const m=JSON.parse(line);events.push(m);if(!m.method&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}});
  await call('initialize',{clientInfo:{name:'compensation_test',version:'1'},capabilities:{experimentalApi:true}});input.write(JSON.stringify({method:'initialized'})+'\n');
  const id=(await call('thread/start',{model:'context-fixture',cwd:temp,ephemeral:false,approvalPolicy:'never',sandbox:'read-only',baseInstructions:'Reply OK.',developerInstructions:'Keep this test instruction.'})).thread.id;
  async function turn(text,threadId=id){const offset=events.length;const result=await call('turn/start',{threadId,input:[{type:'text',text}],effort:'low'});for(let n=0;n<400;n++){const done=events.slice(offset).find(e=>e.method==='turn/completed'&&e.params.turn.id===result.turn.id);if(done){assert.equal(done.params.turn.status,'completed');await delay(80);return;}await delay(20);}throw Error('turn did not complete');}
  await turn('First');
  if(interrupt){
   holdNext=true;
   const paused=await call('turn/start',{threadId:id,input:[{type:'text',text:'Pause this response'}]});
   for(let n=0;n<400&&holdNext;n++)await delay(20);
   assert.equal(holdNext,false,'model request must start before interrupting');
   bridge.setPolicy(id,policy,model);
   await call('turn/interrupt',{threadId:id,turnId:paused.turn.id});
   for(let n=0;n<400&&!events.some(e=>e.method==='turn/completed'&&e.params.turn.id===paused.turn.id);n++)await delay(20);
   assert.ok(events.some(e=>e.method==='turn/completed'&&e.params.turn.id===paused.turn.id&&e.params.turn.status==='interrupted'));
   await delay(80);
  }
  await turn('Second');
  if(high||ceiling){
   const record=bridge.records.get(id);
   if(ceiling){
    assert.equal(record.lastUsage.totalTokens,800010);assert.equal(record.compensation.extraTokens,500000);assert.equal(record.compensation.status,'active');assert.equal(record.compensation.targetWindow,920000);assert.ok(record.expectedWindow>=1420000);assert.equal(record.observedWindow,record.expectedWindow);assert.equal(record.phase,'confirmed');assert.equal(record.policy.compact,900000);
    assert.equal(events.filter(e=>e.method==='item/started'&&String(e.params.item?.type).toLowerCase()==='contextcompaction').length,0,'800K real usage must not compact because of 500K old reasoning');
    await turn('Third');
   }
   for(let i=0;i<400&&(record.locked||!events.some(e=>e.method==='item/started'&&String(e.params.item?.type).toLowerCase()==='contextcompaction'));i++)await delay(20);
   const compactions=events.filter(e=>e.method==='item/started'&&String(e.params.item?.type).toLowerCase()==='contextcompaction').length;
   assert.ok(compactions>0,'real-usage threshold must trigger native compaction');assert.equal(record.locked,false);assert.ok(record.lastUsage.totalTokens<realPolicy.compact);assert.equal(record.policy.window,realPolicy.window);
   await turn('Continue after protective compaction');assert.equal(record.locked,false);assert.equal(record.compensation.status,'active');assert.equal(record.policy.window,realPolicy.window);
   return {compactions};
  }
  await turn('Third');
  const record=bridge.records.get(id),compactions=events.filter(e=>e.method==='item/started'&&String(e.params.item?.type).toLowerCase()==='contextcompaction').length;
  if(enabled){
   assert.equal(compactions,0,JSON.stringify(record.compensation));assert.equal(record.compensation.status,'active');assert.equal(record.compensation.targetWindow,60000);assert.ok(record.observedWindow>60000);assert.equal(record.observedWindow,record.expectedWindow);assert.equal(record.policy.window,policy.window);assert.equal(record.phase,'confirmed');
   assert.equal(requests.length,interrupt?4:3);assert.ok(requests.every(r=>JSON.stringify(r).includes('Keep this test instruction.')));
   const childId=(await call('thread/fork',{threadId:id,excludeTurns:true})).thread.id;
   await turn('Fork keeps its own target',childId);const childRecord=bridge.records.get(childId);
   assert.equal(childRecord.compensation.status,'active',JSON.stringify(bridge.publicRecord(childRecord)));assert.equal(childRecord.compensation.targetWindow,60000);assert.ok(childRecord.compensation.extraTokens>=record.compensation.extraTokens);
   assert.equal(events.filter(e=>e.method==='item/started'&&String(e.params.item?.type).toLowerCase()==='contextcompaction').length,0);
   await call('thread/resume',{threadId:id,excludeTurns:true});await turn('After external resume');assert.equal(record.observedWindow,record.expectedWindow);assert.equal(record.compensation.status,'active');
   const automatic=await bridge.startAutomatic(id,{taskId:'fixture-task',executionId:'fixture-execution',prompt:'Automatic task uses compensation',settings:{}});
   for(let n=0;n<400&&!events.some(e=>e.method==='turn/completed'&&e.params.turn.id===automatic.turnId);n++)await delay(20);
   assert.ok(events.some(e=>e.method==='turn/completed'&&e.params.turn.id===automatic.turnId));await delay(80);assert.equal(record.compensation.status,'active');assert.equal(record.observedWindow,record.expectedWindow);
   manager.setEnabled(false);await turn('After disabling');assert.equal(record.compensation.enabled,false);assert.equal(record.observedWindow,60000);
  }else assert.ok(compactions>0,'control must reproduce premature compaction');
  return {compactions};
 }finally{
  if(child){child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),delay(1000)]);if(child.exitCode===null)child.kill('SIGKILL');}
  for(const p of pending.values())clearTimeout(p.timer);bridge?.frontLines.close();bridge?.backLines.close();input.destroy();output.destroy();server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 }
}
test('signed runtime compensation preserves target capacity, avoids the control reproduction and restores on disable',{skip:!fs.existsSync(binary),timeout:60000},async()=>{await scenario(false);await scenario(true);});
test('signed runtime shrinking a budget during a paused turn compensates before continuing',{skip:!fs.existsSync(binary),timeout:60000},async()=>{await scenario(true,true);});


test('signed runtime accepts accounting headroom beyond catalog capacity while preserving the real target',{skip:!fs.existsSync(binary),timeout:60000},async()=>{await scenario(true,false,{smallCatalog:true});});
test('signed runtime compacts real usage even when server reasoning is already included',{skip:!fs.existsSync(binary),timeout:60000},async()=>{await scenario(true,false,{high:true});});
test('signed runtime keeps 800K plus 500K overhead uncompressed and compacts at a real 900K threshold',{skip:!fs.existsSync(binary),timeout:60000},async()=>{await scenario(true,false,{ceiling:true});});
