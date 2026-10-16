// Exercise the desktop package layout without model inference or user credentials.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import {spawn,spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {realBinary} from '../src/paths.mjs';
import {runtimeFixPin} from '../src/runtime-fix.mjs';
import {installRuntimeHelpers,useDesktopRuntimeLayout,validateRuntimeHelpers} from '../src/runtime-helpers.mjs';
const original=realBinary(),source=process.argv[2]??path.resolve(path.dirname(original),'../CodexCLI.app/Contents/MacOS/codex');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-layout-')),pack=path.join(temp,'package'),home=path.join(temp,'home');
fs.mkdirSync(pack);fs.mkdirSync(home);let child;const pending=new Map();let sequence=0;
try{
  fs.copyFileSync(source,path.join(pack,'codex'),fs.constants.COPYFILE_FICLONE);fs.chmodSync(path.join(pack,'codex'),0o755);
  // The stock reference executable was signed as part of CodexCLI.app. Sign only
  // this temporary copy as a standalone binary, matching our build output.
  const signed=spawnSync('/usr/bin/codesign',['--force','--sign','-',path.join(pack,'codex')],{encoding:'utf8'});assert.equal(signed.status,0,signed.stderr);
  fs.writeFileSync(path.join(pack,'runtime.json'),'{}');
  installRuntimeHelpers(pack,original,runtimeFixPin.baseVersion);useDesktopRuntimeLayout(pack);validateRuntimeHelpers(pack,runtimeFixPin.baseVersion);
  const probes=[['bin/codex',['--version']],['bin/codex-code-mode-host',['--help']],['codex-path/rg',['--version']],['codex-resources/zsh/bin/zsh',['--version']]];
  for(const [file,args] of probes){const r=spawnSync(path.join(pack,file),args,{encoding:'utf8',timeout:10000});assert.equal(r.status,0,`${file}: signal=${r.signal}, error=${r.error?.message}, ${r.stderr?.slice(-300)}`);}
  fs.writeFileSync(path.join(home,'config.toml'),'[features]\nplugins=false\n[analytics]\nenabled=false\n[feedback]\nenabled=false\n');
  child=spawn(path.join(pack,'bin/codex'),['app-server','--listen','stdio://'],{cwd:temp,env:{PATH:'/usr/bin:/bin',HOME:home,CODEX_HOME:home,TMPDIR:temp},stdio:['pipe','pipe','pipe']});
  child.stderr.on('data',()=>{});
  readline.createInterface({input:child.stdout}).on('line',line=>{
    const m=JSON.parse(line),entry=pending.get(m.id);if(!entry)return;
    pending.delete(m.id);clearTimeout(entry.timer);m.error?entry.reject(Error(m.error.message)):entry.resolve(m.result);
  });
  const call=(method,params)=>new Promise((resolve,reject)=>{
    const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('RPC timeout: '+method));},15000);
    pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,method,params})+'\n');
  });
  await call('initialize',{clientInfo:{name:'runtime_layout_probe',version:'1'},capabilities:{experimentalApi:true}});
  child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
  const result=await call('command/exec',{command:['/bin/sh','-c','command -v rg'],cwd:temp,timeoutMs:5000,sandboxPolicy:{type:'readOnly'}});
  assert.equal(result.exitCode,0,JSON.stringify(result));
  assert.equal(fs.realpathSync(result.stdout.trim()),fs.realpathSync(path.join(pack,'codex-path/rg')));
  console.log(JSON.stringify({core:true,codeModeHost:true,search:true,bundledShell:true,appServerCommand:true,searchResolvedInsidePackage:true,remoteInference:false}));
}finally{
  if(child){child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),new Promise(r=>setTimeout(r,1000))]);if(child.exitCode==null)child.kill('SIGKILL');}
  for(const p of pending.values())clearTimeout(p.timer);
  fs.rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100});
}
