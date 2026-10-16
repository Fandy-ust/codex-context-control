// Check native window limits against a loopback fixture. Does not change user config
// or test the remote service's ability to accept a million-token request.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {fixtureServer} from '../test/fixture.mjs';
const repo=fileURLToPath(new URL('../',import.meta.url));
const binary=process.env.CONTEXT_CONTROL_TEST_CODEX||'/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex';
const cases=[
 {name:'stock_catalog',maximum:872000,percent:95,requested:1052632,expected:828400},
 {name:'expanded_catalog_with_headroom',maximum:1050000,percent:95,requested:1050000,expected:997500},
 {name:'one_million_without_percentage_headroom',maximum:1050000,percent:100,requested:1000000,expected:1000000},
];
const report={remoteInference:false,serverCapacityVerified:false,cases:[]};
for(const config of cases){
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-ceiling-')),home=path.join(temp,'home');fs.mkdirSync(home);
 const fixture=await fixtureServer();let child;const pending=new Map();let sequence=0,observed=null,completed=false;
 try{
  const catalog=JSON.parse(fs.readFileSync(path.join(repo,'test/fixtures/models.json')));
  catalog.models[0].max_context_window=config.maximum;catalog.models[0].effective_context_window_percent=config.percent;
  const catalogPath=path.join(temp,'catalog.json');fs.writeFileSync(catalogPath,JSON.stringify(catalog));
  fs.writeFileSync(path.join(home,'config.toml'),`model="context-fixture"\nmodel_provider="fixture"\nmodel_catalog_json=${JSON.stringify(catalogPath)}\nmodel_context_window=${config.requested}\nmodel_auto_compact_token_limit=980000\nmodel_auto_compact_token_limit_scope="total"\n[features]\nplugins=false\n[analytics]\nenabled=false\n[feedback]\nenabled=false\n[model_providers.fixture]\nname="Local ceiling probe"\nbase_url="http://127.0.0.1:${fixture.port}/v1"\nwire_api="responses"\nrequires_openai_auth=false\nsupports_websockets=false\n`);
  child=spawn(binary,['app-server','--listen','stdio://'],{cwd:temp,env:{PATH:process.env.PATH,HOME:home,CODEX_HOME:home,TMPDIR:temp},stdio:['pipe','pipe','pipe']});child.stderr.on('data',()=>{});
  readline.createInterface({input:child.stdout}).on('line',line=>{
   let m;try{m=JSON.parse(line);}catch{return;}
   if(m.id!=null&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}
   if(m.method==='thread/tokenUsage/updated')observed=m.params.tokenUsage.modelContextWindow;
   if(m.method==='turn/completed')completed=true;
  });
  const call=(method,params)=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('RPC timeout: '+method));},15000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,method,params})+'\n');});
  await call('initialize',{clientInfo:{name:'context_ceiling_probe',version:'1'},capabilities:{experimentalApi:true}});child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
  const started=await call('thread/start',{model:'context-fixture',cwd:temp,ephemeral:true,sandbox:'read-only',approvalPolicy:'never',baseInstructions:'Reply OK without tools.'});
  await call('turn/start',{threadId:started.thread.id,input:[{type:'text',text:'Local window metadata test.'}],effort:'low'});
  for(let i=0;i<300&&!completed;i++)await new Promise(r=>setTimeout(r,50));
  assert.equal(completed,true);assert.equal(observed,config.expected);assert.equal(fixture.requests.length,1);
  report.cases.push({...config,observed});
 }finally{
  if(child){const done=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await Promise.race([done,new Promise(r=>setTimeout(r,1000))]);if(child.exitCode==null)child.kill('SIGKILL');}
  for(const p of pending.values())clearTimeout(p.timer);
  fixture.server.closeAllConnections();await new Promise(r=>fixture.server.close(r));
  fs.rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 }
}
fs.mkdirSync(path.join(repo,'build'),{recursive:true});fs.writeFileSync(path.join(repo,'build/context-ceiling-probe.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
