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
