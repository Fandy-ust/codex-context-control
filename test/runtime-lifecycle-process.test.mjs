import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {runtimeParentAlive} from '../src/runtime-lifecycle.mjs';

test('killing a real client cleans up its wrapper and native runtime',{timeout:15000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-runtime-owner-')),pidFile=path.join(dir,'pids.json'),closedFile=path.join(dir,'closed'),logFile=path.join(dir,'errors.log');
 const native=path.join(dir,'native.mjs'),wrapper=path.join(dir,'wrapper.mjs'),client=path.join(dir,'client.mjs');
 fs.writeFileSync(native,"process.stdin.resume();process.on('SIGTERM',()=>{});setInterval(()=>{},1000);");
 fs.writeFileSync(wrapper,`import fs from 'node:fs';import {spawn} from 'node:child_process';
import {watchRuntimeLifecycle} from ${JSON.stringify(new URL('../src/runtime-lifecycle.mjs',import.meta.url).href)};
 process.on('uncaughtException',e=>fs.appendFileSync(${JSON.stringify(logFile)},e.stack+'\\n'));
 const child=spawn(process.execPath,[${JSON.stringify(native)}],{stdio:['pipe','ignore','ignore']});process.stdin.resume();
 watchRuntimeLifecycle({child,input:process.stdin,output:process.stdout,interval:25,grace:75,onDisconnect:()=>fs.appendFileSync(${JSON.stringify(logFile)},'disconnected\\n')});
 fs.writeFileSync(${JSON.stringify(pidFile)},JSON.stringify({wrapper:process.pid,native:child.pid,parent:process.ppid}));
 child.once('exit',()=>{fs.writeFileSync(${JSON.stringify(closedFile)},'native exited');process.exit(0);});`);
 fs.writeFileSync(client,`import {spawn} from 'node:child_process';
spawn(process.execPath,[${JSON.stringify(wrapper)}],{stdio:['pipe','ignore','ignore']});setInterval(()=>{},1000);`);
 const owner=spawn(process.execPath,[client],{stdio:'ignore'});let pids;
 const until=async predicate=>{for(let i=0;i<200;i++){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,25));}throw Error('Runtime cleanup timed out: '+(fs.existsSync(logFile)?fs.readFileSync(logFile,'utf8'):'no wrapper errors, pids='+JSON.stringify(pids)+', owner='+owner.pid+', exit='+owner.exitCode+', signal='+owner.signalCode));};
 try{
  await until(()=>fs.existsSync(pidFile));pids=JSON.parse(fs.readFileSync(pidFile));
  process.kill(pids.native,0);owner.kill('SIGKILL');
  await until(async()=>!await runtimeParentAlive(pids.native)&&!await runtimeParentAlive(pids.wrapper));
  assert.equal(await runtimeParentAlive(pids.native),false);
  assert.equal(await runtimeParentAlive(pids.wrapper),false);
 }finally{
  owner.kill();for(const pid of [pids?.wrapper,pids?.native].filter(Boolean))try{process.kill(pid,'SIGKILL');}catch{}
  fs.rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 }
});
