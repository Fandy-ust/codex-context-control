import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {removeInstallationTree,sha} from '../src/platform/windows-install.mjs';
const repo=fileURLToPath(new URL('../',import.meta.url)),pkg=JSON.parse(fs.readFileSync(path.join(repo,'package.json'),'utf8'));
const payload=path.join(repo,'build',`Context-Manager-${pkg.version}-windows-${process.arch}`,'payload');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-win-install-测试-')),home=path.join(temp,'control'),codex=path.join(temp,'codex'),apps=path.join(temp,'apps');
const env={...process.env,CONTEXT_CONTROL_HOME:home,CONTEXT_CONTROL_CODEX_HOME:codex,CONTEXT_CONTROL_APPLICATIONS:apps};
fs.mkdirSync(home);fs.mkdirSync(codex);
const state={version:9,policies:{},threads:{},futureField:'preserve'},other={hooks:[{type:'command',command:'echo KEEP_OTHER_HOOK'}]};
const uiSettings={version:3,shortcut:{accelerator:'Control+Alt+K',enabled:true},future:'keep'};fs.writeFileSync(path.join(home,'ui-settings.json'),JSON.stringify(uiSettings));
fs.writeFileSync(path.join(home,'settings.json'),JSON.stringify({version:7,futurePreference:{keep:true}}));fs.writeFileSync(path.join(home,'state.json'),JSON.stringify(state));fs.writeFileSync(path.join(home,'language.json'),JSON.stringify({selection:'zh'}));fs.writeFileSync(path.join(codex,'hooks.json'),JSON.stringify({hooks:{Stop:[other]}}));
function install(extra=[],source=payload){const script=source===payload?path.join(repo,'scripts/install-win.mjs'):path.join(source,'resources/app/scripts/install-win.mjs');const r=spawnSync(process.execPath,[script,'--payload',source,'--no-auto-start','--no-open','--no-shortcut',...extra],{env,encoding:'utf8',windowsHide:true,timeout:120000});assert.equal(r.status,0,r.stdout+r.stderr);return JSON.parse(fs.readFileSync(path.join(home,'settings.json'),'utf8'));}
try{
  let s=install();assert.equal(s.version,7);assert.deepEqual(s.futurePreference,{keep:true});assert.equal(fs.existsSync(s.installedApp),true);assert.equal(path.extname(s.node),'.exe');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home,'state.json'),'utf8')),state);
  const version=spawnSync(s.shim,['--version'],{env,encoding:'utf8',windowsHide:true,timeout:15000});assert.equal(version.status,0,version.stderr);assert.match(version.stdout,/^codex-cli /);
  const hook=spawnSync(s.shim,['--hook'],{env,input:'{"hook_event_name":"Stop","session_id":"unknown"}',encoding:'utf8',windowsHide:true,timeout:10000});assert.equal(hook.status,0,hook.stderr);assert.deepEqual(JSON.parse(hook.stdout),{});
  const firstPath=s.installedApp;s=install();assert.equal(s.installedApp,firstPath);assert.equal(fs.readdirSync(path.join(apps,'versions')).length,1);
  let hooks=JSON.parse(fs.readFileSync(path.join(codex,'hooks.json'),'utf8')).hooks.Stop;assert.equal(hooks.length,2);assert.deepEqual(hooks[0],other);
  const start=()=>{const r=spawnSync(s.node,[path.join(s.codeRoot,'src/cli.mjs'),'start'],{env,encoding:'utf8',windowsHide:true,timeout:15000});assert.equal(r.status,0,r.stdout+r.stderr);return JSON.parse(fs.readFileSync(path.join(home,'connection.json'),'utf8'));};
  const oldService=start();
  const upgraded=path.join(temp,'upgrade-payload');fs.cpSync(payload,upgraded,{recursive:true});
  const packageFile=path.join(upgraded,'resources/app/package.json'),metadata=JSON.parse(fs.readFileSync(packageFile,'utf8'));metadata.version='0.17.3';metadata.buildId='windows-upgrade-test';fs.writeFileSync(packageFile,JSON.stringify(metadata));
  const manifestFile=path.join(upgraded,'payload-manifest.json'),manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));manifest.version='0.17.3';manifest.buildId=metadata.buildId;manifest.files['resources/app/package.json']=sha(packageFile);fs.writeFileSync(manifestFile,JSON.stringify(manifest));
  s=install([],upgraded);assert.equal(s.productVersion,'0.17.3');assert.deepEqual(s.futurePreference,{keep:true});assert.equal(JSON.parse(fs.readFileSync(path.join(home,'upgrade-backup/manifest.json'),'utf8')).from,'0.17.2');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home,'ui-settings.json'),'utf8')),uiSettings);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home,'upgrade-backup/ui-settings.json'),'utf8')),uiSettings);
  const newService=start();assert.notEqual(newService.pid,oldService.pid);assert.equal(newService.buildId,'windows-upgrade-test');
  const uninstall=install(['--uninstall']);assert.equal(uninstall.uninstalled,true);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home,'state.json'),'utf8')),state);
  hooks=JSON.parse(fs.readFileSync(path.join(codex,'hooks.json'),'utf8')).hooks.Stop;assert.deepEqual(hooks,[other]);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home,'language.json'),'utf8')),{selection:'zh'});
  assert.equal(fs.existsSync(firstPath),false);
  console.log('WINDOWS_PACKAGE_TEST passed: isolated installation, repeat install, native launcher, hook, future settings, cross-version service upgrade, uninstall and preserved data');
}finally{
  try{const c=JSON.parse(fs.readFileSync(path.join(home,'connection.json'),'utf8'));await fetch(`http://127.0.0.1:${c.port}/shutdown`,{method:'POST',headers:{Authorization:`Bearer ${c.token}`}});await new Promise(r=>setTimeout(r,400));}catch{}
  removeInstallationTree(os.tmpdir(),temp);
}
