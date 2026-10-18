import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {sha,verifyWindowsPayload,removeInstallationTree} from '../src/platform/windows-install.mjs';
test('Windows packages reject wrong architecture, tampering, unknown files and unsafe cleanup',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-payload-')),payload=path.join(root,'payload');fs.mkdirSync(payload);
  const files=['ContextManager.exe','resources/app/vendor/node.exe','resources/app/windows/native/codex-context.exe','resources/app/src/wrapper.mjs'];
  try{
    const manifest={version:'0.17.2',platform:'win32',arch:process.arch,files:{}};
    for(const name of files){const file=path.join(payload,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'test '+name);manifest.files[name]=sha(file);}
    fs.writeFileSync(path.join(payload,'payload-manifest.json'),JSON.stringify(manifest));
    assert.equal(verifyWindowsPayload(payload,{version:'0.17.2'}).platform,'win32');
    assert.throws(()=>verifyWindowsPayload(payload,{arch:'unsupported'}),/architecture/);
    fs.writeFileSync(path.join(payload,'ContextManager.exe'),'tampered');assert.throws(()=>verifyWindowsPayload(payload),/integrity/);
    fs.writeFileSync(path.join(payload,'ContextManager.exe'),'test ContextManager.exe');fs.writeFileSync(path.join(payload,'unexpected.exe'),'extra');assert.throws(()=>verifyWindowsPayload(payload),/integrity/);
    assert.throws(()=>removeInstallationTree(payload,root),/outside/);assert.throws(()=>removeInstallationTree(root,root),/outside/);
    removeInstallationTree(root,payload);assert.equal(fs.existsSync(payload),false);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
