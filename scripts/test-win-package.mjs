import fs from 'node:fs';
import {createWindowsTestRuntime} from './windows-test-runtime.mjs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {removeInstallationTree,sha} from '../src/platform/windows-install.mjs';
import {powershell} from '../src/platform/index.mjs';
import {compileWindowsInstaller} from './windows-installer.mjs';
const repo=fileURLToPath(new URL('../',import.meta.url)),pkg=JSON.parse(fs.readFileSync(path.join(repo,'package.json'),'utf8'));
const payload=path.join(repo,'build',`Context-Manager-${pkg.version}-windows-${process.arch}`,'payload');
const nextVersion=process.argv.includes('--standalone')?pkg.version.split('.').map((part,index)=>Number(part)+(index===2?1:0)).join('.'):pkg.version;
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-win-install-测试-')),home=path.join(temp,'control'),codex=path.join(temp,'codex'),apps=path.join(temp,'apps');
const standalone=process.argv.includes('--standalone'),download=path.join(temp,'download'),extraction=path.join(temp,'extraction');
let setup,upgradeSetup;
if(standalone){
  fs.mkdirSync(download);fs.mkdirSync(extraction);setup=path.join(download,'独立 安装器.exe');
  fs.copyFileSync(path.join(repo,'build',`Context-Manager-${pkg.version}-windows-${process.arch}-Setup.exe`),setup);
  assert.deepEqual(fs.readdirSync(download),[path.basename(setup)]);
}
const env={...process.env,CONTEXT_CONTROL_HOME:home,CONTEXT_CONTROL_CODEX_HOME:codex,CONTEXT_CONTROL_APPLICATIONS:apps,...(standalone?{TEMP:extraction,TMP:extraction}:{})};
fs.mkdirSync(home);fs.mkdirSync(codex);env.CONTEXT_CONTROL_REAL_CODEX=createWindowsTestRuntime(temp);
const state={version:9,policies:{},threads:{},futureField:'preserve'},other={hooks:[{type:'command',command:'echo KEEP_OTHER_HOOK'}]};
const uiSettings={version:3,shortcut:{accelerator:'Control+Alt+K',enabled:true},future:'keep'};fs.writeFileSync(path.join(home,'ui-settings.json'),JSON.stringify(uiSettings));
fs.writeFileSync(path.join(home,'settings.json'),JSON.stringify({version:7,futurePreference:{keep:true}}));fs.writeFileSync(path.join(home,'state.json'),JSON.stringify(state));fs.writeFileSync(path.join(home,'language.json'),JSON.stringify({selection:'zh'}));fs.writeFileSync(path.join(codex,'hooks.json'),JSON.stringify({hooks:{Stop:[other]}}));
function install(extra=[],source=payload){
  const script=source===payload?path.join(repo,'scripts/install-win.mjs'):path.join(source,'resources/app/scripts/install-win.mjs');
  const flags=['--no-auto-start','--no-open','--no-shortcut'];
  const command=standalone?(source===payload?setup:upgradeSetup):process.execPath;
  const args=standalone?[extra.includes('--uninstall')?'--uninstall':'--install',...flags]:[script,'--payload',source,...flags,...extra];
  const r=spawnSync(command,args,{env,encoding:'utf8',windowsHide:true,timeout:120000});assert.equal(r.status,0,r.stdout+r.stderr);
  if(standalone)assert.deepEqual(fs.readdirSync(extraction),[],'Self-extracting installer must remove temporary files');
  return JSON.parse(fs.readFileSync(path.join(home,'settings.json'),'utf8'));
}
try{
  let s=install();assert.equal(s.version,7);assert.deepEqual(s.futurePreference,{keep:true});assert.equal(fs.existsSync(s.installedApp),true);assert.equal(path.extname(s.node),'.exe');
  assert.equal(s.hookCommand,null);assert.equal(fs.existsSync(path.join(home,'automatic-startup.json')),false);assert.equal(JSON.parse(fs.readFileSync(path.join(home,'integration.json'))).enabled,false);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home,'state.json'),'utf8')),state);
  const version=spawnSync(s.shim,['--version'],{env,encoding:'utf8',windowsHide:true,timeout:15000});assert.equal(version.status,0,version.stderr);assert.match(version.stdout,/^codex-cli /);
  const hook=spawnSync(s.shim,['--hook'],{env,input:'{"hook_event_name":"Stop","session_id":"unknown"}',encoding:'utf8',windowsHide:true,timeout:10000});assert.equal(hook.status,0,hook.stderr);assert.deepEqual(JSON.parse(hook.stdout),{});
  const cli=path.join(home,'bin/context-manager.cmd');assert.ok(fs.existsSync(cli));
  const cliVersion=spawnSync(process.env.ComSpec||'cmd.exe',['/d','/s','/c',`""${cli}" --version"`],{env,encoding:'utf8',windowsHide:true,windowsVerbatimArguments:true,timeout:15000});assert.equal(cliVersion.status,0,cliVersion.stderr);assert.equal(cliVersion.stdout.trim(),pkg.version);
  const skillRoot=path.join(temp,'agent skills');
  const skillInstall=spawnSync(process.env.ComSpec||'cmd.exe',['/d','/s','/c',`""${cli}" skill install --path "${skillRoot}""`],{env,encoding:'utf8',windowsHide:true,windowsVerbatimArguments:true,timeout:15000});assert.equal(skillInstall.status,0,skillInstall.stderr);assert.equal(JSON.parse(skillInstall.stdout).data.changed,true);assert.match(fs.readFileSync(path.join(skillRoot,'context-manager/SKILL.md'),'utf8'),/name: context-manager/);
  const firstPath=s.installedApp;s=install();assert.equal(s.installedApp,firstPath);assert.equal(fs.readdirSync(path.join(apps,'versions')).length,1);
  if(standalone){
    fs.unlinkSync(setup);
    const installed=spawnSync(s.shim,['--version'],{env,encoding:'utf8',windowsHide:true,timeout:15000});assert.equal(installed.status,0,installed.stderr);assert.match(installed.stdout,/^codex-cli /);
  }
  let hooks=JSON.parse(fs.readFileSync(path.join(codex,'hooks.json'),'utf8')).hooks.Stop;assert.deepEqual(hooks,[other]);
  const start=()=>{const r=spawnSync(s.node,[path.join(s.codeRoot,'src/cli.mjs'),'start'],{env,encoding:'utf8',windowsHide:true,timeout:15000});assert.equal(r.status,0,r.stdout+r.stderr);return JSON.parse(fs.readFileSync(path.join(home,'connection.json'),'utf8'));};
  const oldService=start();
  const upgraded=path.join(temp,'upgrade-payload');fs.cpSync(payload,upgraded,{recursive:true});
  const packageFile=path.join(upgraded,'resources/app/package.json'),metadata=JSON.parse(fs.readFileSync(packageFile,'utf8'));metadata.version=nextVersion;metadata.buildId='windows-upgrade-test';fs.writeFileSync(packageFile,JSON.stringify(metadata));
  const manifestFile=path.join(upgraded,'payload-manifest.json'),manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));manifest.version=nextVersion;manifest.buildId=metadata.buildId;manifest.files['resources/app/package.json']=sha(packageFile);fs.writeFileSync(manifestFile,JSON.stringify(manifest));
  if(standalone){
    const archive=path.join(temp,'upgrade.zip'),checksum=archive+'.sha256';upgradeSetup=path.join(download,'新版 安装器.exe');
    powershell('Add-Type -AssemblyName System.IO.Compression.FileSystem;[IO.Compression.ZipFile]::CreateFromDirectory($env:CTC_SOURCE,$env:CTC_ZIP)',{CTC_SOURCE:upgraded,CTC_ZIP:archive},{timeout:180000});
    fs.writeFileSync(checksum,sha(archive));compileWindowsInstaller({output:upgradeSetup,icon:path.join(repo,'build/windows-native/ContextManager.ico'),archive,checksum});
  }
  s=install([],upgraded);assert.equal(s.productVersion,nextVersion);assert.deepEqual(s.futurePreference,{keep:true});if(standalone)assert.equal(JSON.parse(fs.readFileSync(path.join(home,'upgrade-backup/manifest.json'),'utf8')).from,pkg.version);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home,'ui-settings.json'),'utf8')),uiSettings);if(standalone)assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home,'upgrade-backup/ui-settings.json'),'utf8')),uiSettings);
  const newService=start();assert.notEqual(newService.pid,oldService.pid);assert.equal(newService.buildId,'windows-upgrade-test');
  const uninstall=install(['--uninstall'],standalone?upgraded:payload);assert.equal(uninstall.uninstalled,true);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home,'state.json'),'utf8')),state);
  hooks=JSON.parse(fs.readFileSync(path.join(codex,'hooks.json'),'utf8')).hooks.Stop;assert.deepEqual(hooks,[other]);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home,'language.json'),'utf8')),{selection:'zh'});
  assert.equal(fs.existsSync(firstPath),false);
  console.log((standalone?'WINDOWS_SETUP_TEST':'WINDOWS_PACKAGE_TEST')+' passed: isolated installation, repeat install, native launcher, hook, future settings, same-build/cross-version service replacement, uninstall and preserved data'+(standalone?'; single EXE without sibling files, temporary cleanup and deletion of downloaded installer':''));
}finally{
  try{const c=JSON.parse(fs.readFileSync(path.join(home,'connection.json'),'utf8'));await fetch(`http://127.0.0.1:${c.port}/shutdown`,{method:'POST',headers:{Authorization:`Bearer ${c.token}`}});await new Promise(r=>setTimeout(r,400));}catch{}
  removeInstallationTree(os.tmpdir(),temp);
}
