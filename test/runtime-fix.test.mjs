import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {runtimeFixPin,createRuntimeFixManager,fileSHA256,validateRuntimePackage} from '../src/runtime-fix.mjs';
import {installRuntimeHelpers,validateRuntimeHelpers} from '../src/runtime-helpers.mjs';

function fixture(){
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-fix-'));
  const directory=path.join(home,'runtimes',runtimeFixPin.id),original=path.join(home,'original');
  fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(original,'original');
  fs.mkdirSync(path.join(directory,'bin'));const binary=path.join(directory,'bin/codex');fs.writeFileSync(binary,'synthetic runtime',{mode:0o755});
  const manifest={...runtimeFixPin,entrypoint:'bin/codex',platform:'darwin',arch:'arm64',validated:true,binarySHA256:fileSHA256(binary)};
  fs.writeFileSync(path.join(directory,'runtime.json'),JSON.stringify(manifest));
  fs.mkdirSync(path.join(directory,'codex-resources'));fs.mkdirSync(path.join(directory,'codex-path'));
  for(const name of ['bin/codex-code-mode-host','codex-path/rg'])fs.writeFileSync(path.join(directory,name),'helper',{mode:0o755});
  fs.writeFileSync(path.join(directory,'codex-package.json'),'{}');
  fs.writeFileSync(path.join(directory,'helpers.json'),JSON.stringify({baseVersion:runtimeFixPin.baseVersion,files:Object.fromEntries(['bin/codex-code-mode-host','codex-path/rg','codex-package.json'].map(name=>[name,fileSHA256(path.join(directory,name))]))}));
  let originalVersion='0.160.0';
  const manager=createRuntimeFixManager({home,platform:'darwin',arch:'arm64',versionOf:file=>file===original?originalVersion:'0.160.0'});
  return {home,directory,binary,original,manifest,manager,upgrade:()=>{originalVersion='0.162.1';},close:()=>fs.rmSync(home,{recursive:true,force:true})};
}

test('optional runtime fix defaults off, reports pending activation and can be disabled',()=>{
  const f=fixture();try{
    assert.equal(f.manager.status(f.original).enabled,false);
    assert.equal(f.manager.select(f.original).binary,f.original);
    const enabled=f.manager.setEnabled(true,f.original,[{}]);
    assert.equal(enabled.pending,true);assert.equal(enabled.available,true);
    assert.equal(f.manager.select(f.original).binary,f.binary);
    const active=f.manager.status(f.original,[{runtimeFixId:runtimeFixPin.id}]);
    assert.equal(active.pending,false);assert.equal(active.activeCount,1);
    const disabled=f.manager.setEnabled(false,f.original,[{runtimeFixId:runtimeFixPin.id}]);
    assert.equal(disabled.pending,true);assert.equal(f.manager.select(f.original).binary,f.original);
    assert.equal(f.manager.status(f.original,[]).pending,false);
  }finally{f.close();}
});

test('Codex updates, corrupted binaries and missing packages always select the original',()=>{
  const f=fixture();try{
    f.manager.setEnabled(true,f.original);f.upgrade();
    assert.equal(f.manager.select(f.original).binary,f.original);
    assert.equal(f.manager.status(f.original).compatible,false);
    assert.throws(()=>f.manager.setEnabled(true,f.original),/版本不匹配/);
    f.manager.setEnabled(false,f.original);
  }finally{f.close();}
  const corrupt=fixture();try{
    corrupt.manager.setEnabled(true,corrupt.original);
    fs.writeFileSync(corrupt.binary,'modified runtime');
    assert.equal(corrupt.manager.select(corrupt.original).binary,corrupt.original);
    assert.equal(corrupt.manager.status(corrupt.original).available,false);
    fs.rmSync(corrupt.directory,{recursive:true});
    assert.equal(corrupt.manager.select(corrupt.original).binary,corrupt.original);
  }finally{corrupt.close();}
});

test('runtime packages require pinned sources, matching architecture, validation and executable hash',()=>{
  const f=fixture();try{
    for(const change of [{sourceCommit:'untrusted'},{patchSHA256:'bad'},{validated:false},{arch:'x64'}]){
      fs.writeFileSync(path.join(f.directory,'runtime.json'),JSON.stringify({...f.manifest,...change}));
      assert.throws(()=>validateRuntimePackage(f.directory,{platform:'darwin',arch:'arm64'}));
    }
    fs.writeFileSync(path.join(f.directory,'runtime.json'),JSON.stringify(f.manifest));
    fs.unlinkSync(f.binary);fs.symlinkSync(f.original,f.binary);
    assert.throws(()=>validateRuntimePackage(f.directory,{platform:'darwin',arch:'arm64'}),/文件无效/);
  }finally{f.close();}
});

test('broken preference files fail closed and enabled state survives a manager restart',()=>{
  const f=fixture();try{
    f.manager.setEnabled(true,f.original);
    const restarted=createRuntimeFixManager({home:f.home,platform:'darwin',arch:'arm64',versionOf:()=>runtimeFixPin.baseVersion});
    assert.equal(restarted.select(f.original).binary,f.binary);
    fs.writeFileSync(path.join(f.home,'runtime-fix.json'),'{broken');
    assert.equal(restarted.select(f.original).binary,f.original);
    assert.throws(()=>f.manager.setEnabled('true',f.original),/开关值无效/);
  }finally{f.close();}
});

test('a nested desktop executable update invalidates version checks even when its launcher is unchanged',{skip:process.platform==='win32'},()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-nested-runtime-'));
  try{
    const launcher=path.join(home,'codex-cli/bin/codex');
    const actual=path.join(home,'codex-cli/CodexCLI.app/Contents/MacOS/codex');
    fs.mkdirSync(path.dirname(launcher),{recursive:true});fs.mkdirSync(path.dirname(actual),{recursive:true});
    fs.writeFileSync(launcher,'#!/bin/sh\nexec "$(dirname "$0")/../CodexCLI.app/Contents/MacOS/codex" "$@"\n',{mode:0o755});
    fs.writeFileSync(actual,"#!/bin/sh\nprintf 'codex-cli 0.160.0\\n'\n",{mode:0o755});
    const manager=createRuntimeFixManager({home,platform:'darwin',arch:'arm64'});
    assert.equal(manager.status(launcher).compatible,true);
    fs.writeFileSync(actual,"#!/bin/sh\nprintf 'codex-cli 0.162.1\\n'\n");
    assert.equal(manager.status(launcher).originalVersion,'0.162.1');
    assert.equal(manager.status(launcher).compatible,false);
  }finally{fs.rmSync(home,{recursive:true,force:true});}
});

test('helper changes invalidate a cached ready package and select the original',()=>{
  const f=fixture();try{
    f.manager.setEnabled(true,f.original);
    assert.equal(f.manager.select(f.original).binary,f.binary);
    fs.writeFileSync(path.join(f.directory,'bin/codex-code-mode-host'),'changed helper');
    assert.equal(f.manager.status(f.original).available,false);
    assert.equal(f.manager.select(f.original).binary,f.original);
  }finally{f.close();}
});

test('desktop helpers are copied independently, version checked and verified',{skip:process.platform==='win32'},()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-helpers-'));
  try{
    const source=path.join(home,'desktop'),out=path.join(home,'installed');
    for(const d of ['bin','codex-path','codex-resources/voice'])fs.mkdirSync(path.join(source,d),{recursive:true});
    fs.mkdirSync(out);
    const layout={version:'0.160.0',layoutVersion:1,entrypoint:'bin/codex',resourcesDir:'codex-resources',pathDir:'codex-path'};
    fs.writeFileSync(path.join(source,'codex-package.json'),JSON.stringify(layout));
    const original=path.join(source,'bin/codex');
    fs.writeFileSync(original,"#!/bin/sh\nprintf 'codex-cli 0.160.0\\n'\n",{mode:0o755});
    for(const name of ['bin/codex-code-mode-host','codex-path/rg'])fs.writeFileSync(path.join(source,name),'helper',{mode:0o755});
    fs.writeFileSync(path.join(source,'codex-resources/voice/data'),'original resource');
    installRuntimeHelpers(out,original,'0.160.0');validateRuntimeHelpers(out,'0.160.0');
    fs.writeFileSync(path.join(source,'codex-resources/voice/data'),'updated resource');
    assert.equal(fs.readFileSync(path.join(out,'codex-resources/voice/data'),'utf8'),'original resource');
    fs.writeFileSync(path.join(source,'codex-package.json'),JSON.stringify({...layout,version:'0.162.1'}));
    assert.throws(()=>installRuntimeHelpers(out,original,'0.160.0'),/版本/);
    fs.writeFileSync(path.join(source,'codex-package.json'),JSON.stringify(layout));
    fs.writeFileSync(original,"#!/bin/sh\nprintf 'codex-cli 0.162.1\\n'\n");
    assert.throws(()=>installRuntimeHelpers(out,original,'0.160.0'),/版本/);
    fs.writeFileSync(path.join(out,'codex-path/rg'),'corrupt');
    assert.throws(()=>validateRuntimeHelpers(out,'0.160.0'),/校验/);
  }finally{fs.rmSync(home,{recursive:true,force:true});}
});

test('transient version probe failures are retried without modifying the executable',{skip:process.platform==='win32'},()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-retry-version-'));
 try{
  const binary=path.join(home,'codex');
  fs.writeFileSync(binary,'#!/bin/sh\nif [ -f "'+home+'/ready" ]; then printf "codex-cli 0.160.0\\n"; else exit 1; fi\n',{mode:0o755});
  const manager=createRuntimeFixManager({home,platform:'darwin',arch:'arm64',versionRetryMs:0});
  assert.equal(manager.status(binary).compatible,false);
  fs.writeFileSync(path.join(home,'ready'),'ready');assert.equal(manager.status(binary).compatible,true);
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});

test('temporary fixed-runtime version failures do not permanently poison package availability',()=>{
 const f=fixture();let ready=false;
 try{
  const manager=createRuntimeFixManager({home:f.home,platform:'darwin',arch:'arm64',versionRetryMs:0,versionOf:file=>file===f.binary&&!ready?null:runtimeFixPin.baseVersion});
  assert.equal(manager.status(f.original).available,false);ready=true;
  assert.equal(manager.status(f.original).available,true);
 }finally{f.close();}
});
