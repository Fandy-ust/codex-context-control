import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
test('Windows environment registration is idempotent and preserves later external changes',{skip:process.platform!=='win32',timeout:90000},async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-win-env-')),key='CONTEXT_CONTROL_TEST_'+crypto.randomBytes(8).toString('hex');
  process.env.CONTEXT_CONTROL_HOME=path.join(temp,'control');
  const {powershell}=await import('../src/platform/index.mjs'),{enableAutomaticStartup,disableAutomaticStartup,automaticStartupStatus}=await import('../src/automatic-startup.mjs');
  const shim=path.join(temp,'launcher.exe'),options={key,recordFile:path.join(temp,'registration.json')};fs.writeFileSync(shim,'fixture');
  try{
    assert.equal(enableAutomaticStartup(shim,options).environmentActive,true);assert.equal(enableAutomaticStartup(shim,options).environmentActive,true);assert.equal(automaticStartupStatus(options).installed,true);
    powershell('[Environment]::SetEnvironmentVariable($env:CONTEXT_CONTROL_TEST_KEY,"external","User")',{CONTEXT_CONTROL_TEST_KEY:key});
    assert.throws(()=>enableAutomaticStartup(shim,options),/其他自定义设置/);disableAutomaticStartup(options);
    assert.equal(powershell('[Environment]::GetEnvironmentVariable($env:CONTEXT_CONTROL_TEST_KEY,"User")',{CONTEXT_CONTROL_TEST_KEY:key}),'external');
  }finally{powershell('[Environment]::SetEnvironmentVariable($env:CONTEXT_CONTROL_TEST_KEY,$null,"User")',{CONTEXT_CONTROL_TEST_KEY:key});fs.rmSync(temp,{recursive:true,force:true});}
});
