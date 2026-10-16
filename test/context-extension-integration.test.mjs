import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import readline from 'node:readline';import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';import {fixtureServer} from './fixture.mjs';
const repo=fileURLToPath(new URL('../',import.meta.url)),binary='/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));async function until(fn){for(let i=0;i<300;i++){const r=await fn();if(r)return r;await sleep(25);}throw Error('Mode transition timed out');}
test('real runtime toggles between extended and native limits; defaults and forks work in both modes',{skip:!fs.existsSync(binary),timeout:60000},async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-mode-')),home=path.join(temp,'home'),control=path.join(temp,'control');fs.mkdirSync(home);fs.mkdirSync(control);const fixture=await fixtureServer();
 const catalog=path.join(repo,'test/fixtures/models.json');fs.copyFileSync(catalog,path.join(home,'models_cache.json'));fs.writeFileSync(path.join(control,'context-extension.json'),JSON.stringify({enabled:true}));
 fs.writeFileSync(path.join(home,'config.toml'),`model="context-fixture"\nmodel_provider="fixture"\nmodel_catalog_json=${JSON.stringify(catalog)}\n[features]\nplugins=false\n[analytics]\nenabled=false\n[feedback]\nenabled=false\n[model_providers.fixture]\nname="Local mode test"\nbase_url="http://127.0.0.1:${fixture.port}/v1"\nrequires_openai_auth=false\nsupports_websockets=false\nwire_api="responses"\n`);
 process.env.CONTEXT_CONTROL_HOME=control;process.env.CONTEXT_CONTROL_CODEX_HOME=home;const {request}=await import('../src/ipc.mjs');let session;
 async function start(){
  const child=spawn(process.execPath,[path.join(repo,'src/wrapper.mjs'),'app-server','--listen','stdio://','-c','model_reasoning_effort="low"'],{cwd:temp,env:{PATH:process.env.PATH,HOME:temp,CODEX_HOME:home,TMPDIR:temp,CONTEXT_CONTROL_HOME:control,CONTEXT_CONTROL_CODEX_HOME:home,CONTEXT_CONTROL_REAL_CODEX:binary},stdio:['pipe','pipe','pipe']});
  let seq=0;const pending=new Map(),events=[];child.stderr.on('data',()=>{});
  readline.createInterface({input:child.stdout}).on('line',line=>{const m=JSON.parse(line);if(m.id!=null&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}else events.push(m);});
  const call=(method,params)=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>reject(Error('Timeout '+method)),15000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,method,params})+'\n');});
  await call('initialize',{clientInfo:{name:'mode_fixture',version:'1'},capabilities:{experimentalApi:true}});child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
  await until(async()=>{try{return (await request('state')).bridgeCount===1;}catch{return false;}});
  return {child,call,async turn(id){const offset=events.length;const t=await call('turn/start',{threadId:id,input:[{type:'text',text:'Local mode window check.'}]});await until(()=>events.slice(offset).some(e=>e.method==='turn/completed'&&e.params.turn.id===t.turn.id));return events.slice(offset).filter(e=>e.method==='thread/tokenUsage/updated').at(-1)?.params.tokenUsage.modelContextWindow;},async close(){child.kill('SIGTERM');for(const p of pending.values())clearTimeout(p.timer);await until(async()=>(await request('state')).bridgeCount===0);}};
 }
 async function toggle(enabled){const c=JSON.parse(fs.readFileSync(path.join(control,'connection.json')));const r=await fetch(`http://127.0.0.1:${c.port}/context-extension`,{method:'POST',headers:{authorization:`Bearer ${c.token}`},body:JSON.stringify({enabled})});assert.equal(r.status,200);return r.json();}
 try{
  session=await start();const a=(await session.call('thread/start',{model:'context-fixture',cwd:temp,approvalPolicy:'never',sandbox:'read-only'})).thread.id;assert.equal(await session.turn(a),920000);
  assert.equal((await request('state')).contextExtension.effective,true);
  const count=fixture.requests.length;const off=await toggle(false);assert.equal(off.enabled,false);assert.equal(off.effective,false);assert.equal(off.pending,true);assert.equal(fixture.requests.length,count);
  let state=await request('state'),row=state.threads.find(t=>t.id===a);assert.equal(row.modelMetadata.max_context_window,872000);assert.equal(row.modelMetadata.effective_context_window_percent,95);assert.equal(row.modelMetadata.context_catalog_ready,false);assert.equal(state.newChatDefaultsLimits.maximumUsableWindow,828000);assert.equal(state.newChatDefaults.usableWindow,828000);
  await assert.rejects(request('setPolicy',{id:a,policy:{window:872000,compact:700000,reserve:16000},apply:true}),/重开|重新打开/);
  await session.close();state=await request('state');assert.equal(state.contextExtension.pending,false);assert.equal(state.contextExtension.effective,false);
  session=await start();await session.call('thread/resume',{threadId:a,excludeTurns:true});assert.equal(await session.turn(a),828400);
  const fork=(await session.call('thread/fork',{threadId:a,excludeTurns:true})).thread.id;assert.equal(await session.turn(fork),828400);
  const b=(await session.call('thread/start',{model:'context-fixture',cwd:temp,approvalPolicy:'never',sandbox:'read-only'})).thread.id;assert.equal(await session.turn(b),828000);
  state=await request('state');row=state.threads.find(t=>t.id===b);assert.equal(row.modelMetadata.context_catalog_ready,true);assert.equal(row.policy.effectivePercent,95);assert.equal(row.policy.contextCeilingVersion,undefined);
  await toggle(true);assert.equal((await request('state')).contextExtension.pending,true);await session.close();
  state=await request('state');assert.equal(state.contextExtension.effective,false);assert.match(state.contextExtension.message,/等待 Codex 启动/);
  session=await start();await request('setNewChatDefaults',{usableWindow:920000,compact:904000,expectedRevision:(await request('state')).newChatDefaults.revision});
  const c=(await session.call('thread/start',{model:'context-fixture',cwd:temp,approvalPolicy:'never',sandbox:'read-only'})).thread.id;assert.equal(await session.turn(c),920000);state=await request('state');assert.equal(state.contextExtension.effective,true);assert.equal(state.runtimeFix.enabled,false);
 }finally{if(session)await session.close().catch(()=>{});try{const c=JSON.parse(fs.readFileSync(path.join(control,'connection.json')));process.kill(c.pid,'SIGTERM');}catch{}fixture.server.closeAllConnections();await new Promise(r=>fixture.server.close(r));await sleep(150);fs.rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
