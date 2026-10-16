import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
test('observation bursts coalesce while user budgets and explicit flush remain durable',async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-save-schedule-'));process.env.CONTEXT_CONTROL_HOME=temp;process.env.CONTEXT_CONTROL_CODEX_HOME=temp;
 const {Store}=await import('../src/store.mjs');const s=new Store();
 try{
  for(let i=0;i<1000;i++){s.data.threads.chat={id:'chat',observedWindow:i};s.scheduleSave(20);}
  assert.equal(s.diagnostics().writes,0);await new Promise(r=>setTimeout(r,50));assert.equal(s.diagnostics().writes,1);assert.equal(JSON.parse(fs.readFileSync(s.file)).threads.chat.observedWindow,999);
  s.data.threads.chat.observedWindow=1000;s.scheduleSave(100);s.data.policies.chat={window:400000};s.save();assert.equal(JSON.parse(fs.readFileSync(s.file)).policies.chat.window,400000);assert.equal(s.diagnostics().observationSavePending,false);
  s.data.threads.chat.observedWindow=1001;s.scheduleSave(100);s.flush();assert.equal(JSON.parse(fs.readFileSync(s.file)).threads.chat.observedWindow,1001);
  await new Promise(r=>setTimeout(r,150));assert.equal(s.diagnostics().writes,3);
 }finally{s.flush();fs.rmSync(temp,{recursive:true,force:true});}
});
test('native refresh rates slow only when hidden or disconnected',{skip:process.platform!=='darwin'},()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-refresh-')),repo=fileURLToPath(new URL('../',import.meta.url));
 try{const main=path.join(temp,'main.swift');fs.writeFileSync(main,`import Foundation\nprecondition(RefreshSchedule.interval(menuVisible:true,settingsVisible:false,runningChats:0,connected:false,serviceAvailable:true)==1)\nprecondition(RefreshSchedule.interval(menuVisible:false,settingsVisible:true,runningChats:0,connected:true,serviceAvailable:true)==2)\nprecondition(RefreshSchedule.interval(menuVisible:false,settingsVisible:false,runningChats:1,connected:true,serviceAvailable:true)==2)\nprecondition(RefreshSchedule.interval(menuVisible:false,settingsVisible:false,runningChats:0,connected:true,serviceAvailable:true)==6)\nprecondition(RefreshSchedule.interval(menuVisible:false,settingsVisible:false,runningChats:0,connected:false,serviceAvailable:true)==15)\nprecondition(RefreshSchedule.tolerance(for:15)==2)\n`);
 const binary=path.join(temp,'check');let r=spawnSync('xcrun',['swiftc',path.join(repo,'macos/RefreshSchedule.swift'),main,'-o',binary],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);r=spawnSync(binary,[],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
