import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {fixtureServer} from './fixture.mjs';
const binary=process.env.CONTEXT_CONTROL_TEST_CODEX||'/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex',repo=fileURLToPath(new URL('../',import.meta.url));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<600;i++){const result=await fn();if(result)return result;await sleep(25);}throw Error('Scheduled native handoff timed out');}

test('actual runtime yields, loads the budget, schedules one same-chat continuation and cancels on user steering',{skip:!fs.existsSync(binary),timeout:60000},async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'cm-schedule-native-')),home=path.join(temp,'codex'),control=path.join(temp,'control');fs.mkdirSync(home);fs.mkdirSync(control);fs.writeFileSync(path.join(control,'context-extension.json'),JSON.stringify({enabled:true}));process.env.CONTEXT_CONTROL_HOME=control;process.env.CONTEXT_CONTROL_CODEX_HOME=home;
 const held=new Set();let highReported=false;const fixture=await fixtureServer({usageForRequest:request=>{const text=JSON.stringify([...(request.input??[])].reverse().find(i=>i.role==='user'));if(text.includes('SOURCE_THREE')&&!highReported){highReported=true;return 610000;}return 120;},holdForRequest:request=>{const text=JSON.stringify([...(request.input??[])].reverse().find(i=>i.role==='user'));for(const marker of ['SOURCE_ONE','SOURCE_TWO','SOURCE_THREE'])if(text.includes(marker)&&!held.has(marker)){held.add(marker);return true;}return false;}}),catalog=path.join(repo,'test/fixtures/models.json');fs.copyFileSync(catalog,path.join(home,'models_cache.json'));
 fs.writeFileSync(path.join(home,'config.toml'),`model="context-fixture"\nmodel_provider="fixture"\nmodel_catalog_json=${JSON.stringify(catalog)}\ncli_auth_credentials_store="file"\n[features]\nplugins=false\n[analytics]\nenabled=false\n[feedback]\nenabled=false\n[model_providers.fixture]\nname="Local schedule fixture"\nbase_url="http://127.0.0.1:${fixture.port}/v1"\nwire_api="responses"\nrequires_openai_auth=false\nsupports_websockets=false\n`);
 const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:temp,CODEX_HOME:home,CONTEXT_CONTROL_CODEX_HOME:home,CONTEXT_CONTROL_HOME:control,CONTEXT_CONTROL_REAL_CODEX:binary,CONTEXT_CONTROL_CATALOG_PATH:catalog,CONTEXT_CONTROL_NEW_CHAT_DEFAULTS:'0',CONTEXT_CONTROL_CONTEXT_CEILING:'1'};
 let command=process.execPath,args=[path.join(repo,'src/wrapper.mjs'),'app-server','--listen','stdio://'];
 if(process.platform==='darwin'&&process.env.CONTEXT_CONTROL_TEST_NATIVE_LAUNCHER){command=path.join(temp,'launcher');fs.copyFileSync(process.env.CONTEXT_CONTROL_TEST_NATIVE_LAUNCHER,command);fs.chmodSync(command,0o700);fs.writeFileSync(command+'.json',JSON.stringify({node:process.execPath,wrapper:path.join(repo,'src/wrapper.mjs'),original:binary,home:control}));args=args.slice(1);}
 const child=spawn(command,args,{env,cwd:temp,stdio:['pipe','pipe','pipe']}),events=[],pending=new Map();let serial=0,errors='',quotaPeer;
 child.stderr.on('data',d=>errors+=d);readline.createInterface({input:child.stdout}).on('line',line=>{const m=JSON.parse(line);events.push(m);if(!m.method&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}});
 const call=(method,params)=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error(method+' timeout '+errors.slice(-500)));},15000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,method,params})+'\n');});
 try{
  await call('initialize',{clientInfo:{name:'schedule_integration',version:'1'},capabilities:{experimentalApi:true}});child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
  const id=(await call('thread/start',{model:'context-fixture',cwd:temp,sandbox:'read-only',approvalPolicy:'never',config:{model_context_window:500000,model_auto_compact_token_limit:450000}})).thread.id;
  const source=(await call('turn/start',{threadId:id,input:[{type:'text',text:'SOURCE_ONE: perform the original task.'}]})).turn.id;
  await until(()=>held.has('SOURCE_ONE'));
  const {request,connect}=await import('../src/ipc.mjs');await until(async()=>{try{return (await request('state')).threads.find(t=>t.id===id&&t.connected&&t.status==='active');}catch{return null;}});
  quotaPeer=await connect();await quotaPeer.call('registerBridge',{pid:process.pid});await quotaPeer.call('observeQuota',{account:{type:'chatgpt',id:'schedule-fixture',email:'fixture@example.test'},observedAt:Date.now(),rateLimitsByLimitId:{codex:{primary:{usedPercent:10,windowDurationMins:300,resetsAt:Math.floor(Date.now()/1000)+3600}}}});
  const connection=JSON.parse(fs.readFileSync(path.join(control,'connection.json'))),client=async(operation,params)=>{const {CONTROL_ROUTES}=await import('../src/contracts/control-api.mjs');const route=CONTROL_ROUTES[operation],response=await fetch(`http://127.0.0.1:${connection.port}${route.path}`,{method:route.method,headers:{Authorization:`Bearer ${connection.token}`},body:JSON.stringify(params)}),value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value;};
  const budget=await client('policy',{id,track:true,requestId:'budget-before-handoff',budget:{usableWindow:700000,compact:630000,reserve:16000},apply:true});
  const {runManagerCLI}=await import('../src/manager-cli.mjs');const checkpoint='Continue original task. Existing progress is saved; perform the remaining verification without repeating completed work.';
  const scheduleArgs=['chat','schedule',id,'--prompt-file','checkpoint.txt','--request-id','handoff-native-1','--after-operation',budget.operation.id];
  const scheduled=await runManagerCLI(scheduleArgs,{client,readFile:async()=>checkpoint});assert.equal(scheduled.nextAction,'finish_turn');assert.equal(fixture.requests.length,1);
  assert.equal((await runManagerCLI(scheduleArgs,{client,readFile:async()=>checkpoint})).schedule.id,scheduled.schedule.id);
  fixture.release();await until(async()=>{const value=await client('context-schedule',{id,action:'list'});return value.schedules.find(s=>s.id===scheduled.schedule.id)?.state==='completed';});
  assert.equal(fixture.requests.length,2,'one original request and one scheduled continuation');assert.ok(JSON.stringify(fixture.requests[1].input).includes(checkpoint));
  const nativeTurns=events.filter(e=>e.method==='turn/started'&&e.params.threadId===id);assert.equal(nativeTurns.length,2);assert.equal(nativeTurns[0].params.turn.id,source);
  assert.equal(events.filter(e=>e.method==='thread/tokenUsage/updated'&&e.params.threadId===id).at(-1).params.tokenUsage.modelContextWindow,700000);
  await client('context-schedule',{id,action:'schedule',prompt:checkpoint,requestId:'handoff-native-1',afterOperation:budget.operation.id});await sleep(50);assert.equal(fixture.requests.length,2);
  const source2=(await call('turn/start',{threadId:id,input:[{type:'text',text:'SOURCE_TWO: another stage.'}]})).turn.id;await until(()=>held.has('SOURCE_TWO'));
  const cancelled=await client('context-schedule',{id,action:'schedule',prompt:'Unsent continuation',requestId:'handoff-native-2'});
  await call('turn/steer',{threadId:id,expectedTurnId:source2,input:[{type:'text',text:'Wait for my next instruction; do not schedule more work.'}]});
  await until(async()=>(await client('context-schedule',{id,action:'list'})).schedules.find(s=>s.id===cancelled.schedule.id)?.state==='cancelled');
  fixture.release();await until(()=>events.some(e=>e.method==='turn/completed'&&e.params.turn.id===source2));await sleep(100);assert.equal(events.filter(e=>e.method==='turn/started'&&e.params.threadId===id).length,3,'user steering must not create an extra scheduled turn');
  const beforeCompact=fixture.requests.length;
  await call('turn/start',{threadId:id,input:[{type:'text',text:'SOURCE_THREE: finish a stage and compact before continuing.'}]});await until(()=>held.has('SOURCE_THREE'));
  const compact=await client('compact',{id,track:true,whenIdle:true,requestId:'explicit-compact-before-handoff'});
  const afterCompact=await client('context-schedule',{id,action:'schedule',prompt:'Continue after the explicitly completed compaction.',requestId:'handoff-native-3',afterOperation:compact.operation.id});
  fixture.release();await until(async()=>(await client('context-schedule',{id,action:'list'})).schedules.find(s=>s.id===afterCompact.schedule.id)?.state==='completed');
  assert.equal(fixture.requests.length,beforeCompact+3,'one original request, one explicit compaction and one continuation');
 }finally{
  fixture.release();quotaPeer?.close();child.stdin.end();await Promise.race([new Promise(r=>child.once('exit',r)),sleep(2000)]);if(child.exitCode==null)child.kill('SIGKILL');
  try{process.kill(JSON.parse(fs.readFileSync(path.join(control,'connection.json'))).pid,'SIGTERM');}catch{}
  fixture.server.closeAllConnections();fixture.server.close();for(const p of pending.values())clearTimeout(p.timer);await sleep(100);fs.rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 }
});
