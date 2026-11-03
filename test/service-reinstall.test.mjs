import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';import {fileURLToPath,pathToFileURL} from 'node:url';import {DatabaseSync} from 'node:sqlite';
import {replaceDirectory} from '../src/install-layout.mjs';
test('same-version code replacement preserves cwd and lets the real service start statistics workers',{timeout:30000},async()=>{
 const repo=fileURLToPath(new URL('../',import.meta.url)),temp=fs.mkdtempSync(path.join(os.tmpdir(),'cm-reinstall-')),code=path.join(temp,'code'),home=path.join(temp,'codex'),control=path.join(temp,'control'),id='11111111-1111-1111-1111-111111111111';fs.mkdirSync(home);fs.mkdirSync(control);
 const prepare=stage=>{fs.cpSync(path.join(repo,'src'),path.join(stage,'src'),{recursive:true});fs.cpSync(path.join(repo,'runtime-patches'),path.join(stage,'runtime-patches'),{recursive:true});fs.copyFileSync(path.join(repo,'package.json'),path.join(stage,'package.json'));fs.symlinkSync(path.join(repo,'node_modules'),path.join(stage,'node_modules'),process.platform==='win32'?'junction':'dir');};replaceDirectory(code,prepare);
 const log=path.join(home,'history.jsonl');fs.writeFileSync(log,JSON.stringify({type:'session_meta',payload:{id}})+'\n'+JSON.stringify({type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'A local fixture.'}]}})+'\n');fs.copyFileSync(new URL('fixtures/models.json',import.meta.url),path.join(home,'models_cache.json'));
 const db=new DatabaseSync(path.join(home,'state_5.sqlite'));db.exec('CREATE TABLE threads(id TEXT PRIMARY KEY,rollout_path TEXT,model TEXT)');db.prepare('INSERT INTO threads VALUES(?,?,?)').run(id,log,'context-fixture');db.close();
 const helper=path.join(temp,'start.mjs');fs.writeFileSync(helper,`const {ensureDaemon}=await import(${JSON.stringify(pathToFileURL(path.join(code,'src/service.mjs')).href)});await ensureDaemon();`);
 const env={...process.env,CONTEXT_CONTROL_HOME:control,CONTEXT_CONTROL_CODEX_HOME:home,CODEX_HOME:home,CONTEXT_CONTROL_REAL_CODEX:process.execPath};let connection;
 try{
  const child=spawn(process.execPath,[helper],{cwd:code,env,stdio:['ignore','ignore','pipe']});let errors='';child.stderr.on('data',d=>errors+=d);assert.equal(await new Promise(r=>child.once('close',r)),0,errors);
  connection=JSON.parse(fs.readFileSync(path.join(control,'connection.json')));assert.equal(fs.realpathSync(connection.script),fs.realpathSync(path.join(code,'src/daemon.mjs')));
  replaceDirectory(code,prepare);
  const response=await fetch(`http://127.0.0.1:${connection.port}/context-stats`,{method:'POST',headers:{Authorization:`Bearer ${connection.token}`},body:JSON.stringify({id}),signal:AbortSignal.timeout(15000)});const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));assert.equal(value.threadId,id);
 }finally{
  if(connection)try{await fetch(`http://127.0.0.1:${connection.port}/shutdown`,{method:'POST',headers:{Authorization:`Bearer ${connection.token}`}});}catch{}
  await new Promise(r=>setTimeout(r,300));if(connection)try{process.kill(connection.pid,'SIGTERM');}catch{}fs.rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 }
});
