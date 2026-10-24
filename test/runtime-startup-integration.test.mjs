import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {probeAppServer} from '../src/runtime-probe.mjs';
import {prepareContextCatalog} from '../src/context-ceiling.mjs';
import {checkRuntimeCompatibility,readRuntimeCompatibility} from '../src/runtime-compatibility.mjs';

const binary=process.env.CONTEXT_CONTROL_TEST_CODEX;
const available=!!binary&&fs.existsSync(binary),wrapper=fileURLToPath(new URL('../src/wrapper.mjs',import.meta.url));
function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-startup-test-')),home=path.join(dir,'codex'),control=path.join(dir,'control');
  fs.mkdirSync(home);fs.mkdirSync(control);
  fs.writeFileSync(path.join(home,'config.toml'),'[features]\nplugins=false\n[analytics]\nenabled=false\n[feedback]\nenabled=false\n');
  const env={...process.env,CODEX_HOME:home,CONTEXT_CONTROL_CODEX_HOME:home,CONTEXT_CONTROL_HOME:control,CONTEXT_CONTROL_REAL_CODEX:binary,CONTEXT_CONTROL_NEW_CHAT_DEFAULTS:'0',CONTEXT_CONTROL_CONTEXT_CEILING:'0'};
  return {dir,home,control,env,close:()=>fs.rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100})};
}
test('actual runtime startup policy, help and unknown commands remain native',{skip:!available,timeout:30000},()=>{
  const f=fixture();try{
    for(const args of [['app-server','--print-startup-config'],['app-server','--help'],['app-server','future-test-command']]){
      const options={env:f.env,cwd:f.dir,windowsHide:true,timeout:8000};
      const native=spawnSync(binary,args,options),wrapped=spawnSync(process.execPath,[wrapper,...args],options);
      assert.ifError(native.error);assert.ifError(wrapped.error);
      assert.equal(wrapped.status,native.status,wrapped.stderr?.toString());assert.deepEqual(wrapped.stdout,native.stdout);
      assert.equal(fs.existsSync(path.join(f.control,'runtime-compatibility.json')),false);
      assert.equal(fs.existsSync(path.join(f.control,'connection.json')),false);
    }
  }finally{f.close();}
});
test('actual runtime confirms existing context extension overrides before enabling the bridge',{skip:!available,timeout:20000},async()=>{
  const f=fixture();try{
    fs.copyFileSync(new URL('./fixtures/models.json',import.meta.url),path.join(f.home,'models_cache.json'));
    const catalog=prepareContextCatalog({home:f.home,control:f.control,enabled:true});assert.ok(catalog?.version);
    const result=await checkRuntimeCompatibility({binary,home:f.control,managerVersion:'integration',extraArgs:catalog.args});
    assert.equal(result.enhanced,true,result.reason);
  }finally{f.close();}
});
test('failed cached validation forwards a fresh connection without replay or management service',{skip:!available,timeout:15000},async()=>{
  const f=fixture();try{
    const metadata=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));
    await checkRuntimeCompatibility({binary,home:f.control,managerVersion:metadata.version+':'+(metadata.buildId??'source'),probe:async()=>{throw Object.assign(Error('fixture'),{code:'probe-config-rejected'});}});
    assert.equal(readRuntimeCompatibility(f.control).enhanced,false);
    const result=await probeAppServer({command:process.execPath,args:[wrapper,'app-server','--listen','stdio://'],env:f.env,cwd:f.dir,timeout:10000,cleanupGrace:2000});
    assert.equal(result.ok,true);assert.equal(readRuntimeCompatibility(f.control).enhanced,false);
    assert.equal(fs.existsSync(path.join(f.control,'connection.json')),false);
  }finally{f.close();}
});

test('Windows executable chain completes the full handshake with enhancements enabled',{skip:!available||process.platform!=='win32',timeout:20000},async()=>{
  const f=fixture();try{
    const exe=path.join(f.dir,'codex-context.exe'),compiler=path.join(process.env.SystemRoot,'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
    const build=spawnSync(compiler,['/nologo','/target:winexe','/reference:System.Web.Extensions.dll','/out:'+exe,fileURLToPath(new URL('../windows/native/Launcher.cs',import.meta.url))],{encoding:'utf8',windowsHide:true,timeout:10000});
    assert.equal(build.status,0,build.stdout+build.stderr);
    fs.writeFileSync(path.join(f.dir,'launcher.json'),JSON.stringify({node:process.execPath,codeRoot:fileURLToPath(new URL('../',import.meta.url)),controlHome:f.control}));
    const result=await probeAppServer({command:exe,env:f.env,cwd:f.dir,timeout:10000,cleanupGrace:2000});
    assert.equal(result.ok,true);assert.equal(readRuntimeCompatibility(f.control)?.enhanced,true);
    const preflightScript=`import {probeWindowsLauncher} from ${JSON.stringify(new URL('../src/platform/windows-probe.mjs',import.meta.url).href)};await probeWindowsLauncher(process.argv[1],process.argv[2]);`;
    const preflight=spawnSync(process.execPath,['--input-type=module','-e',preflightScript,exe,binary],{env:f.env,cwd:f.dir,windowsHide:true,encoding:'utf8',timeout:12000});
    assert.ifError(preflight.error);assert.equal(preflight.status,0,preflight.stderr);
  }finally{
    try{const c=JSON.parse(fs.readFileSync(path.join(f.control,'connection.json'),'utf8'));await fetch(`http://127.0.0.1:${c.port}/shutdown`,{method:'POST',headers:{Authorization:`Bearer ${c.token}`},signal:AbortSignal.timeout(2000)});}catch{}
    await new Promise(resolve=>setTimeout(resolve,500));f.close();
  }
});
