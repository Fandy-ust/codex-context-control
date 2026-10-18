import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('Windows executable launcher preserves binary stdio, Unicode arguments, cwd, hook mode and exit code',{skip:process.platform!=='win32',timeout:20000},()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-shim-测试-')),code=path.join(root,'Code With Spaces'),exe=path.join(root,'shim.exe'),meta=path.join(root,'meta.json');fs.mkdirSync(path.join(code,'src'),{recursive:true});
  try{
    const compiler=path.join(process.env.SystemRoot,'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
    const build=spawnSync(compiler,['/nologo','/target:winexe','/reference:System.Web.Extensions.dll','/out:'+exe,fileURLToPath(new URL('../windows/native/Launcher.cs',import.meta.url))],{encoding:'utf8',windowsHide:true});assert.equal(build.status,0,build.stdout+build.stderr);
    const script='import fs from "node:fs";fs.writeFileSync(process.env.CTC_TEST_META,JSON.stringify({args:process.argv.slice(2),cwd:process.cwd()}));process.stdin.pipe(process.stdout);process.stdin.on("end",()=>{process.stderr.write("stderr preserved");process.exitCode=7;});';
    for(const file of ['wrapper.mjs','cli.mjs'])fs.writeFileSync(path.join(code,'src',file),script);
    fs.writeFileSync(path.join(root,'launcher.json'),JSON.stringify({node:process.execPath,codeRoot:code,controlHome:root}));
    const args=['hello world','中文🙂','a"b','C:\\trailing space\\','& do not run',''];const input=Buffer.from([0,1,255,13,10,0,128]);
    const result=spawnSync(exe,args,{input,cwd:root,env:{...process.env,CTC_TEST_META:meta},windowsHide:true,timeout:10000});
    assert.equal(result.status,7,result.error?.message);assert.deepEqual(result.stdout,input);assert.equal(result.stderr.toString(),'stderr preserved');const reported=JSON.parse(fs.readFileSync(meta,'utf8'));assert.deepEqual(reported.args,args);assert.equal(fs.realpathSync.native(reported.cwd),fs.realpathSync.native(root));
    const hook=spawnSync(exe,['--hook'],{input:'{}',cwd:root,env:{...process.env,CTC_TEST_META:meta},windowsHide:true,timeout:10000});assert.equal(hook.status,7);assert.deepEqual(JSON.parse(fs.readFileSync(meta,'utf8')).args,['hook']);
  }finally{fs.rmSync(root,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
});
