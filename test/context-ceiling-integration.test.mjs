import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import readline from 'node:readline';import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';import {fixtureServer} from './fixture.mjs';
const repo=fileURLToPath(new URL('../',import.meta.url)),binary=process.env.CONTEXT_CONTROL_TEST_CODEX||'/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));async function until(fn){for(let i=0;i<400;i++){const result=await fn();if(result)return result;await sleep(25);}throw Error('Ceiling integration timed out');}
const compensation=true;
test('native runtime retires old compensation while preserving 920K, native compaction and input guards',{skip:!fs.existsSync(binary),timeout:60000},async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-ceiling-live-')),home=path.join(temp,'home'),control=path.join(temp,'control');fs.mkdirSync(home);fs.mkdirSync(control);fs.writeFileSync(path.join(control,'context-extension.json'),JSON.stringify({enabled:true}));if(compensation)fs.writeFileSync(path.join(control,'compaction-compensation.json'),JSON.stringify({enabled:true}));
 let highDone=false,nearDone=false;
 const fixture=await fixtureServer({usageForRequest(request){const last=JSON.stringify([...(request.input??[])].reverse().find(i=>i.role==='user'));
  if(last.includes('CEILING_HIGH')&&!highDone){highDone=true;return 905000;}
  if(last.includes('CEILING_NEAR')&&!nearDone){nearDone=true;return 890000;}return 120;
 }});
 const catalog=path.join(repo,'test/fixtures/models.json');fs.copyFileSync(catalog,path.join(home,'models_cache.json'));
 fs.writeFileSync(path.join(home,'config.toml'),`model="context-fixture"\nmodel_provider="fixture"\n[features]\nplugins=false\n[analytics]\nenabled=false\n[feedback]\nenabled=false\n[model_providers.fixture]\nname="Loopback ceiling test"\nbase_url="http://127.0.0.1:${fixture.port}/v1"\nrequires_openai_auth=false\nsupports_websockets=false\nwire_api="responses"\n`);
 process.env.CONTEXT_CONTROL_HOME=control;process.env.CONTEXT_CONTROL_CODEX_HOME=home;const {request}=await import('../src/ipc.mjs');
 const child=spawn(process.execPath,[path.join(repo,'src/wrapper.mjs'),'-c','features.code_mode_host=true','app-server','--listen','stdio://','-c','model_reasoning_effort="low"'],{cwd:temp,env:{PATH:process.env.PATH,HOME:temp,TMPDIR:temp,CODEX_HOME:home,CONTEXT_CONTROL_HOME:control,CONTEXT_CONTROL_CODEX_HOME:home,CONTEXT_CONTROL_REAL_CODEX:binary,CONTEXT_CONTROL_CONTEXT_CEILING:'1'},stdio:['pipe','pipe','pipe']});
 const pending=new Map(),events=[];let sequence=0;child.stderr.on('data',()=>{});
 readline.createInterface({input:child.stdout}).on('line',line=>{const m=JSON.parse(line);if(m.id!=null&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}else events.push(m);});
 const call=(method,params)=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>reject(Error('Timeout '+method)),20000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,method,params})+'\n');});
 const turn=async(id,text)=>{const offset=events.length;const r=await call('turn/start',{threadId:id,input:[{type:'text',text}]});await until(()=>events.slice(offset).find(e=>e.method==='turn/completed'&&e.params.turn.id===r.turn.id));return events.slice(offset);};
 try{
  await call('initialize',{clientInfo:{name:'ceiling_integration',version:'1'},capabilities:{experimentalApi:true}});child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
  const resolved=await call('config/read',{includeLayers:false});assert.equal(resolved.config.model_context_window,1022223);assert.equal(resolved.config.model_reasoning_effort,'low');assert.equal(resolved.config.features.code_mode_host,true);assert.ok(resolved.config.model_catalog_json.includes('context-920k-'));
  const a=(await call('thread/start',{model:'context-fixture',cwd:temp,sandbox:'read-only',approvalPolicy:'never',baseInstructions:'Reply with fixture text. Never call tools.',config:{model_context_window:9999999,model_auto_compact_token_limit:9999999}})).thread.id;
  const e=await turn(a,'CEILING_HIGH');assert.ok(e.some(e=>e.method==='thread/tokenUsage/updated'&&e.params.tokenUsage.modelContextWindow===920000));
  assert.ok(e.some(e=>e.method==='item/completed'&&String(e.params.item?.type).toLowerCase()==='contextcompaction'),'native post-turn compaction must finish without another user input');
  let state=await request('state');assert.equal(state.compactionCompensation.enabled,false);assert.equal(state.compactionCompensation.available,false);assert.equal(state.contextCeilingPending,false);assert.equal(state.newChatDefaultsPending,false);assert.equal(state.threads.find(t=>t.id===a).modelMetadata.context_ceiling,920000);
  await assert.rejects(request('setPolicy',{id:a,policy:{window:1022223,compact:919000,reserve:16000},apply:true}),/16K/);
  await turn(a,'CEILING_NEAR');const before=fixture.requests.length;
  const guarded=await turn(a,' a'.repeat(20000));
  assert.ok(guarded.some(e=>e.method==='item/completed'&&String(e.params.item?.type).toLowerCase()==='contextcompaction'),'guard must compact before forwarding large input');
  assert.ok(fixture.requests.length>=before+2,'one summary and one normal request expected');
  assert.equal(fixture.requests.at(-1).model,'context-fixture');
  await request('setNewChatDefaults',{usableWindow:500000,compact:450000,expectedRevision:0});
  const b=(await call('thread/start',{model:'context-fixture',threadSource:'user',cwd:temp,sandbox:'read-only',approvalPolicy:'never'})).thread.id;
  const bEvents=await turn(b,'new chat uses 500K from its first request');assert.ok(bEvents.some(e=>e.method==='thread/tokenUsage/updated'&&e.params.threadId===b&&e.params.tokenUsage.modelContextWindow===500000));
  await request('setNewChatDefaults',{usableWindow:800000,compact:720000,expectedRevision:1});
  assert.equal((await request('state')).threads.find(t=>t.id===b).policy.sourceDefaultsRevision,1);
  const fork=(await call('thread/fork',{threadId:b,excludeTurns:true})).thread.id;
  const fEvents=await turn(fork,'fork keeps parent 500K despite 800K global default');assert.ok(fEvents.some(e=>e.method==='thread/tokenUsage/updated'&&e.params.threadId===fork&&e.params.tokenUsage.modelContextWindow===500000));
  assert.equal((await request('state')).threads.find(t=>t.id===fork).policy.inheritedFrom,b);
  const c=(await call('thread/start',{model:'context-fixture',threadSource:'user',cwd:temp,sandbox:'read-only',approvalPolicy:'never'})).thread.id;
  const cEvents=await turn(c,'next fresh chat uses changed 800K default without restarting');assert.ok(cEvents.some(e=>e.method==='thread/tokenUsage/updated'&&e.params.threadId===c&&e.params.tokenUsage.modelContextWindow===800000));
  const original=(await request('state')).threads.find(t=>t.id===a);assert.equal(original.policy.window,1022223);
  await request('setPolicy',{id:a,policy:{window:777778,compact:630000,reserve:16000},apply:false});child.kill('SIGTERM');await until(async()=>(await request('state')).bridgeCount===0);
  const unloaded=(await request('state')).threads.find(t=>t.id===a);assert.equal(unloaded.modelMetadata.effective_context_window_percent,90);assert.equal(Math.floor(unloaded.policy.window*.9),700000);
 }finally{child.kill('SIGTERM');for(const p of pending.values())clearTimeout(p.timer);await sleep(300);try{const c=JSON.parse(fs.readFileSync(path.join(control,'connection.json')));process.kill(c.pid,'SIGTERM');}catch{}fixture.server.closeAllConnections();await new Promise(r=>fixture.server.close(r));await sleep(150);fs.rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
