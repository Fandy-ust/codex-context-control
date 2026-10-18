import {fileURLToPath} from 'node:url';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';import {once} from 'node:events';

test('abrupt isolated service exits preserve budgets and recover stale locks',{timeout:45000},async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-crash-')),home=path.join(temp,'codex'),root=path.join(temp,'control');fs.mkdirSync(home);fs.mkdirSync(root);
 const binary=path.join(temp,'codex-fixture');fs.writeFileSync(binary,'#!/bin/sh\nprintf "codex-cli 0.160.0\\n"\n',{mode:0o700});
 fs.copyFileSync(new URL('fixtures/models.json',import.meta.url),path.join(home,'models_cache.json'));
 process.env.CONTEXT_CONTROL_HOME=root;process.env.CONTEXT_CONTROL_CODEX_HOME=home;process.env.CONTEXT_CONTROL_REAL_CODEX=binary;
 const {request,connect}=await import('../src/ipc.mjs');let child,peer;
 const start=async()=>{
  child=spawn(process.execPath,[fileURLToPath(new URL('../src/daemon.mjs',import.meta.url))],{env:process.env,stdio:'ignore'});
  for(let n=0;n<250;n++){try{await request('ping',{},100);return;}catch{}await new Promise(r=>setTimeout(r,20));}
  throw Error('Restart failed');
 };
 const stop=async()=>{if(child.exitCode!==null||child.signalCode!==null)return;const exited=once(child,'exit');child.kill('SIGKILL');await exited;};
 try{
  for(let i=1;i<=5;i++){
   await start();const state=await request('state');
   if(i>1){assert.equal(state.threads[0].policy.revision,i-1);assert.equal(state.threads[0].policy.window,400000+(i-1)*1000);assert.equal(state.threads[0].connected,false);assert.equal(state.threads[0].freshUsage,false);}
   peer=await connect();await peer.call('registerBridge',{pid:process.pid});await peer.call('updateThread',{id:'11111111-1111-1111-1111-111111111111',model:'context-fixture',status:'idle',freshUsage:true,observedWindow:380000});
   const saved=await request('setPolicy',{id:'11111111-1111-1111-1111-111111111111',policy:{window:400000+i*1000,compact:300000,reserve:16000},apply:false});assert.equal(saved.policy.revision,i);
   await stop();peer.close();peer=null;
  }
  await start();assert.equal((await request('state')).threads[0].policy.revision,5);
 }finally{peer?.close();if(child)await stop();fs.rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
