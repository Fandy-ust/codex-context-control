import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {checkRuntimeCompatibility,readRuntimeCompatibility,recordRuntimeStartupFailure} from '../src/runtime-compatibility.mjs';
import {probeAppServer} from '../src/runtime-probe.mjs';

function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-compat-test-')),binary=path.join(dir,'codex');fs.writeFileSync(binary,'runtime-one');
  return {dir,binary,home:path.join(dir,'control'),close:()=>fs.rmSync(dir,{recursive:true,force:true,maxRetries:3,retryDelay:50})};
}
test('compatibility evidence follows runtime files, manager version and enhancement settings',async()=>{
  const f=fixture();let count=0,clock=1000;
  const options={...f,managerVersion:'test-1',now:()=>clock,versionOf:()=> 'codex-cli 99.0.0',probe:async({env,cwd,args})=>{
    count++;assert.equal(env.CODEX_HOME,cwd);assert.ok(fs.existsSync(path.join(cwd,'config.toml')));
    assert.ok(!fs.existsSync(path.join(cwd,'auth.json')));
    return {config:{model_context_window:500000}};
  }};
  try{
    const first=await checkRuntimeCompatibility(options);assert.equal(first.enhanced,true);assert.equal(count,1);
    assert.equal((await checkRuntimeCompatibility(options)).cached,true);assert.equal(count,1);
    fs.appendFileSync(f.binary,'-updated');assert.equal((await checkRuntimeCompatibility(options)).cached,false);assert.equal(count,2);
    await checkRuntimeCompatibility({...options,managerVersion:'test-2'});assert.equal(count,3);
    await checkRuntimeCompatibility({...options,extraArgs:['-c','model_context_window=500000']});assert.equal(count,4);
    clock+=86400001;await checkRuntimeCompatibility({...options,extraArgs:['-c','model_context_window=500000']});assert.equal(count,5);
    // Directory contents never enter the persisted cache, only a digest.
    assert.ok(!JSON.stringify(readRuntimeCompatibility(f.home)).includes('model_context_window'));
  }finally{f.close();}
});
test('failed checks cool down, recover, and never reuse evidence across an update',async()=>{
  const f=fixture();let clock=1000,count=0,healthy=false;
  const options={...f,managerVersion:'test',now:()=>clock,versionOf:()=> 'codex-cli 1.2.3',probe:async()=>{count++;if(!healthy)throw Object.assign(Error('private detail'),{code:'probe-config-rejected'});return {config:{}};}};
  try{
    const failed=await checkRuntimeCompatibility(options);assert.equal(failed.enhanced,false);assert.equal(failed.reason,'probe-config-rejected');
    healthy=true;assert.equal((await checkRuntimeCompatibility(options)).enhanced,false);assert.equal(count,1);
    clock+=60001;assert.equal((await checkRuntimeCompatibility(options)).enhanced,true);assert.equal(count,2);
    fs.appendFileSync(f.binary,'new');const next=await checkRuntimeCompatibility(options);assert.equal(next.enhanced,true);assert.equal(count,3);
    recordRuntimeStartupFailure(f.home,failed);assert.equal(readRuntimeCompatibility(f.home).enhanced,true);
    recordRuntimeStartupFailure(f.home,next);assert.equal(readRuntimeCompatibility(f.home).reason,'native-startup-failed');
    assert.equal((await checkRuntimeCompatibility({...options,now:Date.now})).enhanced,false);
  }finally{f.close();}
});
test('malformed cache, unreadable cache destination, ignored overrides and mid-probe upgrades are safe',async()=>{
  const f=fixture(),options={...f,managerVersion:'test',versionOf:()=> 'codex-cli 1.2.3',probe:async()=>({config:{}})};
  try{
    fs.mkdirSync(f.home);fs.writeFileSync(path.join(f.home,'runtime-compatibility.json'),'broken');
    assert.equal((await checkRuntimeCompatibility(options)).enhanced,true);
    const ignored=await checkRuntimeCompatibility({...options,extraArgs:['-c','model_context_window=12345']});assert.equal(ignored.enhanced,false);assert.equal(ignored.reason,'config-override-not-confirmed');
    const changed=await checkRuntimeCompatibility({...options,managerVersion:'new',probe:async()=>{fs.appendFileSync(f.binary,'changed');return {config:{}};}});assert.equal(changed.reason,'runtime-changed-during-probe');
    assert.equal((await checkRuntimeCompatibility({...options,home:f.binary})).enhanced,true);
    assert.equal((await checkRuntimeCompatibility({...options,managerVersion:'bad',versionOf:()=> 'not codex'})).enhanced,false);
  }finally{f.close();}
});

async function probeFixture(mode,timeout=2000){
  const script=`import readline from 'node:readline';let initialized=false;
    readline.createInterface({input:process.stdin}).on('line',line=>{
      const m=JSON.parse(line);const send=result=>process.stdout.write(JSON.stringify({id:m.id,result})+'\\n');
      if(m.method==='initialized'){initialized=true;return;}
      if(m.method==='initialize'){
        if(${JSON.stringify(mode)}==='invalid'){process.stdout.write('invalid\\n');return;}
        send({userAgent:'fixture'});return;
      }
      if(!initialized){process.exit(2);return;}
      if(${JSON.stringify(mode)}==='hang')return;
      if(${JSON.stringify(mode)}==='reject'){process.stdout.write(JSON.stringify({id:m.id,error:{code:-1}})+'\\n');return;}
      if(m.method!=='config/read')process.exit(3);
      else send({config:{model:'fixture',extraFutureField:true}});
    });`;
  return probeAppServer({command:process.execPath,args:['--input-type=module','-e',script],timeout,env:{...process.env}});
}
test('probe completes initialized and a read-only RPC before declaring success',async()=>{
  assert.equal((await probeFixture('ok')).config.model,'fixture');
  await assert.rejects(probeFixture('reject'),{code:'probe-config-rejected'});
  await assert.rejects(probeFixture('invalid'),{code:'probe-invalid-json'});
  await assert.rejects(probeFixture('hang',200),{code:'probe-timeout'});
});
