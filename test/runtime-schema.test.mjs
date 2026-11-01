import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {inspectRuntimeSchema} from '../src/runtime-schema.mjs';
import {checkRuntimeCompatibility} from '../src/runtime-compatibility.mjs';
const methods=['initialize','config/read','thread/start','thread/resume','thread/fork','thread/unsubscribe','thread/settings/update','thread/compact/start','turn/start'];
test('normal compatibility inspection exports local schemas without launching a listening server or fetching models',async()=>{
 const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-schema-test-'));let calls=0;
 const run=(command,args,options)=>{
  calls++;assert.equal(command,'fixture');assert.deepEqual(args.slice(0,3),['app-server','generate-json-schema','--experimental']);assert.ok(!args.includes('--listen'));assert.equal(options.cwd,cwd);
  const out=args.at(-1);fs.mkdirSync(path.join(out,'v2'),{recursive:true});fs.writeFileSync(path.join(out,'ClientRequest.json'),JSON.stringify({oneOf:methods.map(method=>({properties:{method:{enum:[method]}}}))}));fs.writeFileSync(path.join(out,'v2/ThreadResumeParams.json'),JSON.stringify({properties:{threadId:{},config:{}}}));return {status:0};
 };
 try{
  const result=await inspectRuntimeSchema({command:'fixture',cwd,run,extraArgs:['-c','model_context_window=715790']});assert.equal(result.evidence,'local-schema');assert.equal(result.config,undefined,'schema evidence must not pretend to be runtime configuration readback');assert.equal(calls,1);
  const binary=path.join(cwd,'codex');fs.writeFileSync(binary,'fixture');let probes=0,now=1000;
  const options={binary,home:path.join(cwd,'control'),managerVersion:'test',versionOf:()=> 'codex-cli 0.166.0',now:()=>now,probe:async()=>{probes++;return {evidence:'local-schema'};}};
  assert.equal((await checkRuntimeCompatibility(options)).enhanced,true);now+=7*86400000;assert.equal((await checkRuntimeCompatibility(options)).cached,true);assert.equal(probes,1,'unchanged native binaries are not probed on a daily timer');
 }finally{fs.rmSync(cwd,{recursive:true,force:true});}
});
