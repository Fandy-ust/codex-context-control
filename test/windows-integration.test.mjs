import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

test('Windows integration requires explicit opt-in and a successful launch probe, and disabling preserves other hooks and environment changes',{
  skip:process.platform!=='win32',timeout:60000
},async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-integration-')),control=path.join(temp,'control'),codex=path.join(temp,'codex');
  process.env.CONTEXT_CONTROL_HOME=control;process.env.CONTEXT_CONTROL_CODEX_HOME=codex;fs.mkdirSync(control);fs.mkdirSync(codex);
  const key='CONTEXT_CONTROL_TEST_'+crypto.randomBytes(8).toString('hex'),recordFile=path.join(control,'automatic-startup.json');
  const shim=path.join(control,'bin','fixture','codex-context.exe');fs.mkdirSync(path.dirname(shim),{recursive:true});fs.writeFileSync(shim,'fixture');
  const hooks={hooks:{Stop:[{hooks:[{type:'command',command:'KEEP_EXTERNAL'}]}]}};fs.writeFileSync(path.join(codex,'hooks.json'),JSON.stringify(hooks));
  fs.writeFileSync(path.join(control,'settings.json'),JSON.stringify({shim,realBinary:'fixture-native',uninstalled:false,future:'keep'}));
  const {setWindowsIntegration,windowsIntegrationStatus,codexLaunchEnvironment}=await import('../src/windows-integration.mjs');
  const {userEnvironment}=await import('../src/platform/windows-startup.mjs');
  const {powershell}=await import('../src/platform/index.mjs');
  const options={key,recordFile,probe:async()=>{assert.equal(userEnvironment(key),'');}};
  try{
    assert.equal(windowsIntegrationStatus().enabled,false);await setWindowsIntegration(false,options);assert.equal(userEnvironment(key),'');assert.deepEqual(JSON.parse(fs.readFileSync(path.join(codex,'hooks.json'))),hooks);
    await assert.rejects(setWindowsIntegration(true,{...options,probe:async()=>{throw Error('fixture startup failure');}}),/startup failure/);
    assert.equal(userEnvironment(key),'');assert.equal(windowsIntegrationStatus().enabled,false);
    const enabled=await setWindowsIntegration(true,options);assert.equal(enabled.enabled,true);assert.equal(enabled.registered,true);assert.equal(userEnvironment(key),shim);
    assert.equal(JSON.parse(fs.readFileSync(path.join(codex,'hooks.json'))).hooks.Stop.length,2);
    powershell('$key=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey("Environment");try{$key.SetValue($env:CTC_TEST_KEY,"KEEP_EXTERNAL_OVERRIDE")}finally{$key.Dispose()}',{CTC_TEST_KEY:key});
    await assert.rejects(setWindowsIntegration(true,{...options,probe:async()=>{}}),/其他自定义设置/);
    const integrationLog=fs.readFileSync(path.join(control,'logs/integration.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
    assert.ok(integrationLog.some(entry=>entry.stage==='integration.enable_failed'&&entry.phase==='startup'));
    await setWindowsIntegration(false,options);assert.equal(userEnvironment(key),'KEEP_EXTERNAL_OVERRIDE');assert.deepEqual(JSON.parse(fs.readFileSync(path.join(codex,'hooks.json'))),hooks);
    assert.equal(codexLaunchEnvironment({CODEX_CLI_PATH:shim}).CODEX_CLI_PATH,undefined);assert.equal(codexLaunchEnvironment({CODEX_CLI_PATH:'external.exe'}).CODEX_CLI_PATH,'external.exe');
    assert.equal(JSON.parse(fs.readFileSync(path.join(control,'settings.json'))).future,'keep');
  }finally{
    powershell('$key=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey("Environment");try{$key.DeleteValue($env:CTC_TEST_KEY,$false)}finally{$key.Dispose()}',{CTC_TEST_KEY:key});
    fs.rmSync(temp,{recursive:true,force:true});
  }
});
