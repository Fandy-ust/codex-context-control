import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {cleanupWindowsInstallations} from '../src/platform/windows-cleanup.mjs';import {sha} from '../src/platform/windows-install.mjs';
function payload(base,version){const stage=path.join(base,'stage');fs.mkdirSync(stage,{recursive:true});const files={};for(const file of ['ContextManager.exe','resources/app/vendor/node.exe','resources/app/windows/native/codex-context.exe','resources/app/src/wrapper.mjs']){const p=path.join(stage,file);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,'fixture '+version);files[file]=sha(p);}const manifest=path.join(stage,'payload-manifest.json');fs.writeFileSync(manifest,JSON.stringify({platform:'win32',arch:process.arch,version,files}));const target=path.join(base,'versions',version+'-'+sha(manifest).slice(0,12));fs.mkdirSync(path.dirname(target),{recursive:true});fs.renameSync(stage,target);return target;}
test('Windows cleanup retains live/current versions and removes only verified inactive installations',()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-win-clean-')),base=path.join(home,'apps');try{
 const old=payload(base,'0.19.4'),active=payload(base,'0.19.5'),current=payload(base,'0.19.6');
 const config={installBase:base,installedApp:path.join(current,'ContextManager.exe'),desktopExecutable:path.join(home,'Codex.exe')};
 fs.writeFileSync(path.join(home,'state.json'),'keep');fs.mkdirSync(path.join(base,'versions','user-backup'));
 let r=cleanupWindowsInstallations({home,configuration:config,processes:null});assert.equal(r.removed.length,0);
 r=cleanupWindowsInstallations({home,configuration:config,processes:[{executable:config.desktopExecutable}]});assert.equal(r.removed.length,0);
 r=cleanupWindowsInstallations({home,configuration:config,processes:[{executable:path.join(active,'resources/app/vendor/node.exe')}]});assert.ok(r.removed.includes(old));assert.ok(fs.existsSync(active)&&fs.existsSync(current));
 r=cleanupWindowsInstallations({home,configuration:config,processes:[]});assert.ok(r.removed.includes(active));assert.ok(fs.existsSync(current)&&fs.existsSync(path.join(home,'state.json'))&&fs.existsSync(path.join(base,'versions','user-backup')));
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});

test('Windows cleanup removes redirected old shim only after Codex exits',()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-win-retarget-clean-')),base=path.join(home,'apps');try{
  const current=payload(base,'0.19.6'),codeRoot=path.join(current,'resources','app');
  const bin=path.join(home,'bin'),old=path.join(bin,'aaaaaaaaaaaa-bbbbbbbbbbbb'),active=path.join(bin,'cccccccccccc-dddddddddddd');
  for(const folder of [old,active]){fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'codex-context.exe'),'fixture');fs.writeFileSync(path.join(folder,'launcher.json'),JSON.stringify({controlHome:home,codeRoot}));}
  const config={installBase:base,installedApp:path.join(current,'ContextManager.exe'),desktopExecutable:path.join(home,'Codex.exe'),codeRoot,shim:path.join(active,'codex-context.exe')};
  cleanupWindowsInstallations({home,configuration:config,processes:[{executable:config.desktopExecutable}]});assert.ok(fs.existsSync(old));
  cleanupWindowsInstallations({home,configuration:config,processes:[]});assert.equal(fs.existsSync(old),false);assert.ok(fs.existsSync(active));
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
