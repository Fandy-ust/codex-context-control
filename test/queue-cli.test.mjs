import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';import {Readable} from 'node:stream';
import {runQueueCLI,createQueueClient} from '../src/queue-cli.mjs';
import {installQueueCLI,removeQueueCLI} from '../src/cli-launcher.mjs';

test('global monitoring commands preserve chat switches and do not require a chat id',async()=>{
 const calls=[],client=async(op,p)=>{calls.push({op,p});return {queues:[]};};
 await runQueueCLI(['monitoring-off'],{client});await runQueueCLI(['monitoring-on'],{client});
 assert.deepEqual(calls,[{op:'task-queue',p:{action:'monitoring',enabled:false}},{op:'task-queue',p:{action:'monitoring',enabled:true}}]);
});

test('automatic account switching is an explicit global queue setting',async()=>{
 const calls=[],client=async(op,p)=>{calls.push({op,p});return {queues:[]};};
 await runQueueCLI(['account-switch-on'],{client});await runQueueCLI(['account-switch-off'],{client});
 assert.deepEqual(calls,[{op:'task-queue',p:{action:'account-switch',enabled:true}},{op:'task-queue',p:{action:'account-switch',enabled:false}}]);
});
test('queue CLI preserves literal input, supplies revisions, and distinguishes pause from interruption',async()=>{
 const calls=[],client=async(op,p)=>{calls.push({op,p});return op==='state'?{capabilities:{taskQueues:true},taskQueues:{queues:[{id:'chat',revision:7,tasks:[]}]},threads:[],queueModels:[]}:{queues:[]};};
 const prompt='Read $(not-a-command) and `literal`\nThen test 中文.';
 await runQueueCLI(['add','chat','--prompt-file','-','--request-id','agent-task-1'],{client,stdin:Readable.from([prompt])});
 assert.equal(calls[1].p.prompt,prompt);assert.equal(calls[1].p.expectedRevision,7);assert.equal(calls[1].p.requestId,'agent-task-1');
 calls.length=0;await runQueueCLI(['pause','chat','--revision','7'],{client});assert.deepEqual(calls,[{op:'task-queue',p:{id:'chat',action:'enable',enabled:false,expectedRevision:7}}]);
 calls.length=0;await runQueueCLI(['stop','chat','task','--revision','8'],{client});assert.equal(calls[0].p.action,'stop');assert.equal(calls[0].p.taskId,'task');
 calls.length=0;await assert.rejects(runQueueCLI(['start','chat','--unexpected','x'],{client}),e=>e.code==='INVALID_ARGUMENT');assert.equal(calls.length,0);
 await assert.rejects(runQueueCLI(['command','--input','-'],{client,stdin:Readable.from(['{broken'])}),e=>e.code==='INVALID_JSON');
});
test('queue transport fixes the destination to loopback and keeps credentials out of errors',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-cli-http-'));try{
 const token='a'.repeat(64);fs.writeFileSync(path.join(home,'connection.json'),JSON.stringify({port:12345,token}));let ensured=0;
 const client=createQueueClient({home,ensure:async()=>ensured++,fetcher:async(url,options)=>{assert.equal(url,'http://127.0.0.1:12345/state');assert.equal(options.headers.authorization,'Bearer '+token);return new Response(JSON.stringify({error:'denied'}),{status:403});}});
 await assert.rejects(client('state'),e=>e.code==='AUTH_FAILED'&&!e.message.includes(token));assert.equal(ensured,1);
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
test('installed CLI uses bundled Node, quotes paths and arguments, and is replaced on upgrade',{skip:process.platform==='win32'},()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-cli-')),home=path.join(temp,"space's 中文"),code=path.join(temp,'code');try{
 fs.mkdirSync(path.join(code,'src'),{recursive:true});fs.writeFileSync(path.join(code,'src/cli.mjs'),'console.log(JSON.stringify({args:process.argv.slice(2),home:process.env.CONTEXT_CONTROL_HOME}))');
 const cli=installQueueCLI({home,node:process.execPath,codeRoot:code});const args=['queue','--prompt','$(echo secret) `literal` 中文'];const r=spawnSync(cli,args,{encoding:'utf8'});assert.equal(r.status,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout),{args,home});
 const next=path.join(temp,'new code');fs.mkdirSync(path.join(next,'src'),{recursive:true});fs.writeFileSync(path.join(next,'src/cli.mjs'),'console.log("upgraded")');installQueueCLI({home,node:process.execPath,codeRoot:next});assert.equal(spawnSync(cli,[],{encoding:'utf8'}).stdout.trim(),'upgraded');removeQueueCLI(home);assert.equal(fs.existsSync(cli),false);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
test('add request IDs survive service reload and are scoped to the chat',async()=>{
 const {createTaskQueues}=await import('../src/task-queues.mjs');let saved;let next=0;
 const options={thread:()=>({id:'chat',status:'idle'}),quota:{state:()=>({}),refresh:async()=>{}},start:async()=>{},interrupt:async()=>{},save:value=>saved=structuredClone(value),id:()=>String(++next)};
 let queues=createTaskQueues(options);const command={action:'add',id:'chat',prompt:'one task',requestId:'request-1',expectedRevision:0};queues.command(command);queues.close();
 queues=createTaskQueues({...options,load:()=>saved});try{
  queues.command(command);assert.equal(queues.get('chat').tasks.length,1);assert.equal(queues.get('chat').revision,1);
  assert.throws(()=>queues.command({...command,prompt:'different'}),/请求标识/);
  queues.command({...command,id:'other-chat'});assert.equal(queues.get('other-chat').tasks.length,1);
 }finally{queues.close();}
});
