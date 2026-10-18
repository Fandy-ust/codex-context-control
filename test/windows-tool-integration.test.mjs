import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {once} from 'node:events';
import {fixtureServer} from './fixture.mjs';
const binary=process.env.CONTEXT_CONTROL_TEST_CODEX;
test('Windows runtime executes a local PowerShell tool through the bridge and keeps tool output',{skip:process.platform!=='win32'||!binary||!fs.existsSync(binary),timeout:45000},async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-win-tool-')),home=path.join(temp,'codex'),control=path.join(temp,'control');fs.mkdirSync(home);
  const catalog=path.join(home,'models_cache.json'),models=JSON.parse(fs.readFileSync(new URL('./fixtures/models.json',import.meta.url),'utf8'));delete models.models[0].tool_mode;fs.writeFileSync(catalog,JSON.stringify(models));
  let toolName;
  const fixture=await fixtureServer({outputForRequest(request,number){
    if(number>1)return null;
    const tools=request.tools??request.request?.tools??[];
    // Responses Lite can encode tool declarations in the input preamble rather
    // than a tools array. The catalog explicitly selects unified_exec.
    const tool=tools.find(t=>['exec_command','shell_command','shell'].includes(t.name))??{name:'exec_command'};toolName=tool.name;
    const command="Write-Output 'CONTEXT_MANAGER_WINDOWS_TOOL_OK'",args=tool.name==='exec_command'?{cmd:command,workdir:temp,max_output_tokens:1000}:tool.name==='shell_command'?{command,workdir:temp,timeout_ms:10000}:{command:['powershell.exe','-NoProfile','-Command',command],workdir:temp,timeout_ms:10000};
    return {id:'fc_local_tool',type:'function_call',call_id:'call_local_tool',name:tool.name,arguments:JSON.stringify(args),status:'completed'};
  }});
  fs.writeFileSync(path.join(home,'config.toml'),`model="context-fixture"\nmodel_provider="fixture"\nmodel_catalog_json=${JSON.stringify(catalog)}\n[features]\nplugins=false\n[analytics]\nenabled=false\n[feedback]\nenabled=false\n[model_providers.fixture]\nname="Local tool fixture"\nbase_url="http://127.0.0.1:${fixture.port}/v1"\nwire_api="responses"\nrequires_openai_auth=false\nsupports_websockets=false\n`);
  const env={PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:temp,TMP:temp,USERPROFILE:temp,HOME:temp,CODEX_HOME:home,CONTEXT_CONTROL_HOME:control,CONTEXT_CONTROL_CODEX_HOME:home,CONTEXT_CONTROL_REAL_CODEX:binary,CONTEXT_CONTROL_NEW_CHAT_DEFAULTS:'0'};
  const child=spawn(process.execPath,[fileURLToPath(new URL('../src/wrapper.mjs',import.meta.url)),'app-server','--listen','stdio://'],{env,cwd:temp,windowsHide:true,stdio:['pipe','pipe','pipe']});
  const pending=new Map(),events=[];let id=0,stderr='';child.stderr.on('data',data=>stderr+=data);
  readline.createInterface({input:child.stdout}).on('line',line=>{const m=JSON.parse(line),p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}else events.push(m);});
  const call=(method,params)=>new Promise((resolve,reject)=>{const sequence=++id,timer=setTimeout(()=>reject(Error(method+' timeout '+stderr.slice(-1000))),15000);pending.set(sequence,{resolve,reject,timer});child.stdin.write(JSON.stringify({id:sequence,method,params})+'\n');});
  try{
    await call('initialize',{clientInfo:{name:'windows_tool_fixture',version:'1'},capabilities:{experimentalApi:true}});child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
    const thread=(await call('thread/start',{model:'context-fixture',cwd:temp,sandbox:'danger-full-access',approvalPolicy:'never'})).thread.id;
    await call('turn/start',{threadId:thread,input:[{type:'text',text:'Run the local verification tool.'}]});
    const deadline=Date.now()+20000;while(!events.some(e=>e.method==='turn/completed')&&Date.now()<deadline)await new Promise(r=>setTimeout(r,30));
    assert.ok(events.some(e=>e.method==='turn/completed'),stderr);assert.ok(toolName,'A native shell tool must be advertised');assert.ok(fixture.requests.length>=2);
    assert.ok(JSON.stringify(fixture.requests.at(-1).input).includes('CONTEXT_MANAGER_WINDOWS_TOOL_OK'),'Tool stdout must reach the next model request');
    const executed=events.find(e=>e.method==='item/completed'&&e.params.item?.type==='commandExecution');assert.ok(executed,'Command completion must pass through');assert.equal(executed.params.item.exitCode,0);
  }finally{
    child.stdin.end();if(child.exitCode==null)await Promise.race([once(child,'exit'),new Promise(r=>setTimeout(r,5000).unref())]);if(child.exitCode==null){child.kill();await once(child,'exit');}
    try{const c=JSON.parse(fs.readFileSync(path.join(control,'connection.json'),'utf8'));await fetch(`http://127.0.0.1:${c.port}/shutdown`,{method:'POST',headers:{Authorization:`Bearer ${c.token}`}});}catch{}
    for(const p of pending.values())clearTimeout(p.timer);fixture.server.close();fixture.server.closeAllConnections();await new Promise(r=>setTimeout(r,500));fs.rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:300});
  }
});
