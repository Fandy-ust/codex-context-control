import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import {ownedWindowsMenuProcess} from '../src/platform/windows-menu-process.mjs';
test('an installed old UI is found after the install pointer changes, but unrelated processes are excluded',()=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-menu-version-'));
 try{
  const data=JSON.stringify({platform:'win32',version:'0.24.2'}),hash=crypto.createHash('sha256').update(data).digest('hex').slice(0,12);
  const dir=path.join(base,'versions','0.24.2-'+hash);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'payload-manifest.json'),data);const old=path.join(dir,'ContextManager.exe');fs.writeFileSync(old,'fixture');
  const app=path.join(base,'versions','0.24.3-123456789012','ContextManager.exe');fs.mkdirSync(path.dirname(app),{recursive:true});fs.writeFileSync(app,'fixture');const status={pid:123,bundleIdentifier:'io.github.codex-context-control'};
  assert.equal(ownedWindowsMenuProcess({app,installBase:base,status,info:{executable:old}}),123);
  assert.equal(ownedWindowsMenuProcess({app:old,status,info:{executable:old}}),123);
  for(const bad of [path.join(base,'Codex.exe'),path.join(base,'unrelated','ContextManager.exe'),path.join(dir,'node.exe')])assert.equal(ownedWindowsMenuProcess({app,installBase:base,status,info:{executable:bad}}),null);
  assert.equal(ownedWindowsMenuProcess({app,installBase:base,status:{...status,bundleIdentifier:'other'},info:{executable:old}}),null);
  fs.writeFileSync(path.join(dir,'payload-manifest.json'),data+' ');assert.equal(ownedWindowsMenuProcess({app,installBase:base,status,info:{executable:old}}),null);
 }finally{fs.rmSync(base,{recursive:true,force:true});}
});
