import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import {spawn} from 'node:child_process';
import {createContextReminders,contextReminderCommand} from '../src/context-reminders.mjs';
import {fileURLToPath} from 'node:url';
import {fixtureServer} from './fixture.mjs';

const binary=process.env.CONTEXT_CONTROL_TEST_CODEX||(process.platform==='win32'?path.join(process.env.LOCALAPPDATA||'','Programs/OpenAI/Codex/bin/codex.exe'):'/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex');
test('installed native Codex discovers all reminder hooks without trust bypass or model requests',{skip:!fs.existsSync(binary),timeout:20000},async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'cm-reminder-native-')),home=path.join(temp,'control'),codex=path.join(temp,'codex');fs.mkdirSync(home);fs.mkdirSync(codex);
  fs.writeFileSync(path.join(codex,'config.toml'),'[analytics]\nenabled=false\n[feedback]\nenabled=false\n');
  const manager=createContextReminders({home,codex,command:()=>contextReminderCommand({home})});manager.setEnabled(true);
  const child=spawn(binary,['app-server','--listen','stdio://'],{env:{...process.env,CODEX_HOME:codex},cwd:temp,windowsHide:true,stdio:['pipe','pipe','pipe']});
  let serial=0,errors='';const pending=new Map();child.stderr.on('data',value=>errors+=value);
  const lines=readline.createInterface({input:child.stdout});lines.on('line',line=>{const message=JSON.parse(line),p=pending.get(message.id);if(p){pending.delete(message.id);clearTimeout(p.timer);message.error?p.reject(Error(JSON.stringify(message.error))):p.resolve(message.result);}});
  const call=(method,params)=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>reject(Error(method+' timed out: '+errors.slice(-500))),5000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,method,params})+'\n');});
  try{
    await call('initialize',{clientInfo:{name:'context_reminder_discovery_test',version:'1'},capabilities:{experimentalApi:true}});child.stdin.write('{"method":"initialized"}\n');
    const result=await call('hooks/list',{cwds:[temp]});const entries=result.data;assert.equal(entries.length,1);assert.deepEqual(entries[0].errors,[]);assert.deepEqual(entries[0].warnings,[]);
    const own=entries[0].hooks.filter(h=>h.handler?.command?.includes('context-reminder-hook.mjs')||h.command?.includes('context-reminder-hook.mjs'));
    // The runtime publishes handler metadata directly; retain the whole list
    // in assertion diagnostics if its shape changes.
    const hooks=own.length?own:entries[0].hooks;
    assert.deepEqual(hooks.map(h=>h.eventName).sort(),['postCompact','postToolUse','userPromptSubmit']);
    for(const hook of hooks){assert.equal(hook.trustStatus,'untrusted');assert.equal(hook.isManaged,false);}
    assert.equal(manager.status().phase,'awaiting_hook');
  }finally{
    for(const p of pending.values())clearTimeout(p.timer);lines.close();child.stdin.end();
    if(child.exitCode==null)await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,1000))]);
    if(child.exitCode==null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;}
    await fs.promises.rm(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
});

test('native Codex sends the planner and status to the model after UserPromptSubmit',{skip:!fs.existsSync(binary),timeout:25000},async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'cm native hook-')),home=path.join(temp,'control'),codex=path.join(temp,'codex');
  fs.mkdirSync(home);fs.mkdirSync(codex);
  const fixture=await fixtureServer();
  const catalog=fileURLToPath(new URL('./fixtures/models.json',import.meta.url));
  fs.copyFileSync(catalog,path.join(codex,'models_cache.json'));
  fs.writeFileSync(path.join(codex,'config.toml'),`model="context-fixture"\nmodel_provider="fixture"\nmodel_catalog_json=${JSON.stringify(catalog)}\n[model_providers.fixture]\nname="Loopback"\nbase_url="http://127.0.0.1:${fixture.port}/v1"\nwire_api="responses"\nrequires_openai_auth=false\nsupports_websockets=false\n[analytics]\nenabled=false\n[feedback]\nenabled=false\n`);
  const env={...process.env,CODEX_HOME:codex,CONTEXT_CONTROL_HOME:home,CONTEXT_CONTROL_CODEX_HOME:codex,CONTEXT_CONTROL_REAL_CODEX:binary,CONTEXT_CONTROL_NEW_CHAT_DEFAULTS:'0'};
  const manager=createContextReminders({home,codex,command:()=>contextReminderCommand({home,node:process.execPath})});
  manager.setEnabled(true);manager.setAllChats(true);
  const child=spawn(process.execPath,[fileURLToPath(new URL('../src/wrapper.mjs',import.meta.url)),'app-server','--listen','stdio://'],{env,cwd:temp,windowsHide:true,stdio:['pipe','pipe','pipe']});
  let serial=0,errors='';const pending=new Map(),events=[];child.stderr.on('data',value=>errors+=value);
  const lines=readline.createInterface({input:child.stdout});lines.on('line',line=>{const message=JSON.parse(line),p=pending.get(message.id);if(p){pending.delete(message.id);clearTimeout(p.timer);message.error?p.reject(Error(JSON.stringify(message.error))):p.resolve(message.result);}if(message.method)events.push(message);});
  const call=(method,params)=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>reject(Error(method+' timed out: '+errors.slice(-1000))),7000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,method,params})+'\n');});
  try{
    await call('initialize',{clientInfo:{name:'context_reminder_delivery_test',version:'1'},capabilities:{experimentalApi:true}});child.stdin.write('{"method":"initialized"}\n');
    const list=async()=> (await call('hooks/list',{cwds:[temp]})).data[0].hooks;
    const own=await list();assert.equal(own.length,3);
    // Trust only the generated hooks, in this temporary Codex home.
    for(const hook of own)fs.appendFileSync(path.join(codex,'config.toml'),`\n[hooks.state.${JSON.stringify(hook.key)}]\ntrusted_hash = ${JSON.stringify(hook.currentHash)}\n`);
    assert.ok((await list()).every(h=>h.trustStatus==='trusted'));
    const threadId=(await call('thread/start',{model:'context-fixture',cwd:temp,approvalPolicy:'never',sandbox:'read-only'})).thread.id;
    let stateBefore,connection;
    for(let n=0;n<100;n++){
      try{connection=JSON.parse(fs.readFileSync(path.join(home,'connection.json')));
        stateBefore=await (await fetch('http://127.0.0.1:'+connection.port+'/state',{headers:{authorization:'Bearer '+connection.token}})).json();
        if(stateBefore.threads?.some(t=>t.id===threadId&&t.connected))break;
      }catch{/* Wrapper attaches asynchronously. */}
      await new Promise(r=>setTimeout(r,50));
    }
    assert.ok(stateBefore?.threads?.some(t=>t.id===threadId&&t.connected),'fixture chat must attach to the controller');
    await call('turn/start',{threadId,input:[{type:'text',text:'Say hello.'}]});
    for(let n=0;n<150&&!events.some(m=>m.method==='turn/completed');n++)await new Promise(r=>setTimeout(r,50));
    const developer=fixture.requests.flatMap(req=>req.input??[]).filter(item=>item.role==='developer');
    const hooks=events.filter(m=>m.method.startsWith('hook/'));
    assert.ok(JSON.stringify(developer).includes('Context Planner'),JSON.stringify({hooks,errors:errors.slice(-1500),requests:fixture.requests.length}));
    assert.match(JSON.stringify(developer),/Context Manager status/);
    const context=hooks.find(m=>m.method==='hook/completed')?.params.run.entries.find(e=>e.kind==='context')?.text;
    assert.ok(context?.includes('Context Planner'),'native completion reports the accepted context text');
    assert.ok(developer.some(item=>item.content?.some(p=>p.text?.includes(context))),'receipt corresponds to text included in model input');
    const log=await (await fetch('http://127.0.0.1:'+connection.port+'/context-reminders',{method:'POST',headers:{authorization:'Bearer '+connection.token},body:JSON.stringify({action:'log',id:threadId})})).json();
    assert.match(log.events[0].planner,/## Context Planner/);
    assert.equal(log.events[0].delivery,'accepted');
    assert.ok(context.endsWith(log.events[0].planner));
    assert.ok(!JSON.stringify(log).includes('Say hello.'));
  }finally{
    for(const p of pending.values())clearTimeout(p.timer);lines.close();child.stdin.end();
    const exited=proc=>proc.exitCode!=null||proc.signalCode!=null?Promise.resolve():new Promise(resolve=>proc.once('exit',resolve));
    await Promise.race([exited(child),new Promise(r=>setTimeout(r,1000))]);if(child.exitCode==null&&child.signalCode==null){child.kill();await exited(child);}
    try{
      const c=JSON.parse(fs.readFileSync(path.join(home,'connection.json')));
      await fetch('http://127.0.0.1:'+c.port+'/shutdown',{method:'POST',headers:{authorization:'Bearer '+c.token},signal:AbortSignal.timeout(1000)});
      for(let i=0;i<30&&fs.existsSync(path.join(home,'connection.json'));i++)await new Promise(r=>setTimeout(r,50));
    }catch{/* The fixture may fail before service startup. */}
    fixture.server.closeAllConnections();await new Promise(r=>fixture.server.close(r));
    await fs.promises.rm(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
});
