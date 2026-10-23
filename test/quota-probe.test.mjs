import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {runQuotaProbe} from '../src/quota-probe.mjs';

test('probe pins Luna, uses an ephemeral read-only chat and interrupts its own first reply',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'quota-probe-')),log=path.join(dir,'calls.jsonl'),file=path.join(dir,'server.mjs');
  fs.writeFileSync(file,`import readline from 'node:readline';import fs from 'node:fs';
const send=o=>process.stdout.write(JSON.stringify(o)+'\\n');
readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);fs.appendFileSync(${JSON.stringify(log)},line+'\\n');if(m.id==null)return;
if(m.method==='initialize')send({id:m.id,result:{}});
if(m.method==='thread/start')send({id:m.id,result:{thread:{id:'probe-thread'}}});
if(m.method==='turn/start'){send({id:m.id,result:{turn:{id:'probe-turn'}}});send({method:'item/agentMessage/delta',params:{threadId:'someone-else',turnId:'someone-else',delta:'ignore'}});setTimeout(()=>send({method:'item/agentMessage/delta',params:{threadId:'probe-thread',turnId:'probe-turn',delta:'O'}}),10);}
if(m.method==='turn/interrupt')send({id:m.id,result:{}});});`);
  try{
    assert.deepEqual(await runQuotaProbe({binary:process.execPath,launcherArgs:[file]}),{received:true});
    const calls=fs.readFileSync(log,'utf8').trim().split('\n').map(JSON.parse),start=calls.find(m=>m.method==='thread/start').params;
    assert.equal(start.model,'gpt-6-luna');assert.equal(start.ephemeral,true);assert.equal(start.sandbox,'read-only');
    assert.deepEqual(calls.find(m=>m.method==='turn/interrupt').params,{threadId:'probe-thread',turnId:'probe-turn'});
    assert.equal(calls.filter(m=>m.method==='turn/start').length,1);
  }finally{fs.rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

test('an aborted probe does not spawn a model request',async()=>{
  const controller=new AbortController();controller.abort();await assert.rejects(runQuotaProbe({binary:process.execPath,signal:controller.signal}),/取消/);
});
