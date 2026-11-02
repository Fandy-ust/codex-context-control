import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('native macOS launcher keeps the runtime PID, transports bytes, and falls back before consuming GUI input',{skip:process.platform!=='darwin',timeout:30000},async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'cm-native 中文 ')),launcher=path.join(temp,'launcher'),repo=fileURLToPath(new URL('../',import.meta.url));
 const build=spawnSync('xcrun',['swiftc','-O','-target',`${process.arch==='arm64'?'arm64':'x86_64'}-apple-macos14.0`,path.join(repo,'macos/runtime-launcher/main.swift'),'-o',launcher],{encoding:'utf8',timeout:20000});assert.equal(build.status,0,build.stderr);
 const helper=path.join(temp,'helper.mjs');
 fs.writeFileSync(helper,`import {nativeLaunchChannel,sendNativeLaunchPlan,inheritedRuntime} from ${JSON.stringify(new URL('../src/native-channel.mjs',import.meta.url).href)};
 const channel=nativeLaunchChannel(),mode=process.env.FIXTURE_MODE;
 if(mode==='crash')process.exit(7);
 const enhanced=mode==='enhanced'||mode==='invalid';
 if(!sendNativeLaunchPlan(channel,{binary:mode==='invalid'?'relative-invalid':'/bin/sh',args:process.argv.slice(2),enhanced}))process.exit(0);
 if(!enhanced){setInterval(()=>{},1000);}
 else{const backend=inheritedRuntime(channel);process.stdin.pipe(backend.stdin);backend.stdout.pipe(process.stdout);backend.once('close',()=>{process.stdin.destroy();process.stdout.end(()=>process.exit(0));});}
 `);
 fs.writeFileSync(launcher+'.json',JSON.stringify({node:process.execPath,wrapper:helper,original:'/bin/sh',home:path.join(temp,'control')}));
 const payload=Buffer.from([0,255,13,10,...Buffer.from('中文 input with $() and spaces\n')]);
 try{
  for(const mode of ['enhanced','passthrough','invalid','crash']){
   const child=spawn(launcher,['-c','printf "%s\\n" "$$"; /bin/cat; exit 17'],{env:{...process.env,FIXTURE_MODE:mode},stdio:['pipe','pipe','pipe']});
   const output=[],errors=[];child.stdout.on('data',d=>output.push(d));child.stderr.on('data',d=>errors.push(d));child.stdin.end(payload);
   const code=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Launcher did not close its transport: '+mode));},5000);child.once('error',reject);child.once('close',value=>{clearTimeout(timer);resolve(value);});});
   assert.equal(code,17,mode+': '+Buffer.concat(errors).toString());
   const bytes=Buffer.concat(output),newline=bytes.indexOf(10);assert.equal(Number(bytes.subarray(0,newline).toString()),child.pid,mode+' must exec the runtime in the frontend PID');assert.deepEqual(bytes.subarray(newline+1),payload,mode+' must preserve untouched GUI input');
  }
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
