import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';
test('agent CLI uses the live queue service, detects stale writes and deduplicates retry requests',async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-agent-cli-')),control=path.join(temp,'control'),home=path.join(temp,'codex');fs.mkdirSync(control);fs.mkdirSync(home);
 fs.writeFileSync(path.join(control,'state.json'),JSON.stringify({version:2,threads:{chat:{id:'chat',name:'CLI fixture',model:'context-fixture'}},policies:{}}));
 fs.copyFileSync(new URL('./fixtures/models.json',import.meta.url),path.join(home,'models_cache.json'));
 process.env.CONTEXT_CONTROL_HOME=control;process.env.CONTEXT_CONTROL_CODEX_HOME=home;
 const {startDaemon}=await import('../src/daemon.mjs');const d=await startDaemon();
 const cli=fileURLToPath(new URL('../src/cli.mjs',import.meta.url));
 const run=(args,input='',scope='queue')=>new Promise((resolve,reject)=>{const p=spawn(process.execPath,[cli,scope,...args],{env:process.env,stdio:['pipe','pipe','pipe']});let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('error',reject);p.on('close',code=>resolve({code,out,err}));p.stdin.end(input);});
 try{
 const prompt='Complete this task\nwith literal $HOME and 中文.';
 let r=await run(['add','chat','--prompt-file','-','--request-id','retry-test','--revision','0'],prompt);assert.equal(r.code,0,r.err);const first=JSON.parse(r.out).data.queues[0];assert.equal(first.tasks.length,1);assert.equal(first.tasks[0].prompt,prompt);assert.equal(first.enabled,false);
 r=await run(['add','chat','--prompt-file','-','--request-id','retry-test','--revision','0'],prompt);assert.equal(r.code,0,r.err);assert.equal(JSON.parse(r.out).data.queues[0].tasks.length,1);
 r=await run(['add','chat','--prompt','different','--request-id','retry-test']);assert.equal(r.code,1);assert.equal(JSON.parse(r.err).error.code,'QUEUE_REJECTED');
 r=await run(['edit','chat',first.tasks[0].id,'--prompt','new','--revision','0']);assert.equal(r.code,1);
 r=await run(['show','chat']);assert.equal(JSON.parse(r.out).data.queue.tasks[0].prompt,prompt);
 r=await run(['delete','chat',first.tasks[0].id]);assert.equal(r.code,0,r.err);assert.equal(JSON.parse(r.out).data.queues[0].tasks.length,0);
 r=await run(['set','chat','--window','400K','--compact','350K','--save-only'],'','chat');assert.equal(r.code,0,r.err);assert.equal(JSON.parse(r.out).data.policy.window,421053);assert.equal(JSON.parse(r.out).data.policy.enabled,false);
 r=await run(['defaults-set','--window','400K','--compact','360K'],'','global');assert.equal(r.code,0,r.err);assert.equal(JSON.parse(r.out).data.usableWindow,400000);
 r=await run(['status'],'','global');assert.equal(r.code,0,r.err);assert.equal(JSON.parse(r.out).data.chatCount,1);
 const connection=JSON.parse(fs.readFileSync(path.join(control,'connection.json')));assert.ok(!r.out.includes(connection.token));
 }finally{d.web.closeAllConnections();await new Promise(r=>d.web.close(r));await new Promise(r=>d.ipcServer.close(r));fs.rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
