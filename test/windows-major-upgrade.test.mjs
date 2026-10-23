import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {createWindowsTestRuntime} from '../scripts/windows-test-runtime.mjs';
import {removeInstallationTree,verifyWindowsPayload,sha} from '../src/platform/windows-install.mjs';

const previousSetup=process.env.CONTEXT_CONTROL_PREVIOUS_SETUP;
const currentSetup=process.env.CONTEXT_CONTROL_CURRENT_SETUP;
const currentVersion=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8')).version;
test('real ZIP 0.25.4 to current LZMA2 stable upgrade preserves preferences, runtime and exact payload bytes',{
  skip:process.platform!=='win32'||!previousSetup||!currentSetup,timeout:120000
},()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-major-upgrade-测试-'));
  const home=path.join(temp,'control'),codex=path.join(temp,'codex'),apps=path.join(temp,'apps'),extraction=path.join(temp,'extraction');
  for(const dir of [home,codex,extraction])fs.mkdirSync(dir);
  const env={...process.env,CONTEXT_CONTROL_HOME:home,CONTEXT_CONTROL_CODEX_HOME:codex,CONTEXT_CONTROL_APPLICATIONS:apps,CONTEXT_CONTROL_REAL_CODEX:createWindowsTestRuntime(temp),TEMP:extraction,TMP:extraction};
  const files={
    'state.json':{version:2,threads:{},policies:{saved:{window:400000,compact:360000,revision:3}}},
    'ui-settings.json':{version:3,shortcut:{accelerator:'Control+Alt+K',enabled:true},future:'keep'},
    'language.json':{selection:'zh'}
  };
  const install=setup=>{
    const r=spawnSync(path.resolve(setup),['--install','--no-auto-start','--no-open','--no-shortcut'],{env,encoding:'utf8',windowsHide:true,timeout:90000});
    assert.equal(r.status,0,r.stdout+r.stderr);assert.deepEqual(fs.readdirSync(extraction),[]);
    return JSON.parse(fs.readFileSync(path.join(home,'settings.json'),'utf8'));
  };
  try{
    const old=install(previousSetup);assert.equal(old.productVersion,'0.25.4');
    const oldRoot=path.dirname(old.installedApp),before=verifyWindowsPayload(oldRoot);
    const source=path.resolve(`build/Context-Manager-${currentVersion}-windows-x64/payload`);
    const sourceManifest=JSON.parse(fs.readFileSync(path.join(source,'payload-manifest.json'),'utf8'));
    const preserved=name=>/^resources\/app\/(node_modules|vendor)\//.test(name)||name.endsWith('.pak')||name.endsWith('.dll')||name.endsWith('.dat')||name.endsWith('.bin');
    // Git may convert LF/CRLF when creating a new Windows worktree. Permit
    // only that transformation in text sources; binaries must be identical.
    const normalized=new Map();
    for(const name of Object.keys(before.files).filter(preserved)){
      if(before.files[name]!==sourceManifest.files[name]&&/\.(mjs|cjs|js|css|html|json|txt)$/.test(name))
        normalized.set(name,fs.readFileSync(path.join(oldRoot,name),'utf8').replaceAll('\r\n','\n'));
    }
    for(const [name,value] of Object.entries(files))fs.writeFileSync(path.join(home,name),JSON.stringify(value));
    fs.writeFileSync(path.join(home,'settings.json'),JSON.stringify({...old,futurePreference:{keep:true}}));
    const current=install(currentSetup);assert.equal(current.productVersion,currentVersion);
    assert.deepEqual(current.futurePreference,{keep:true});
    for(const [name,value] of Object.entries(files))assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home,name),'utf8')),value);
    assert.equal(JSON.parse(fs.readFileSync(path.join(home,'upgrade-backup/manifest.json'),'utf8')).from,'0.25.4');
    const installedRoot=path.dirname(current.installedApp),after=verifyWindowsPayload(installedRoot);
    assert.deepEqual(after,sourceManifest);
    for(const [name,digest] of Object.entries(after.files))assert.equal(sha(path.join(source,name)),digest,name);
    const oldFiles=Object.keys(before.files).filter(preserved).sort(),newFiles=Object.keys(after.files).filter(preserved).sort();
    assert.deepEqual(newFiles,oldFiles,'No UI, core or runtime files added or removed');
    for(const name of oldFiles){
      if(normalized.has(name))assert.equal(fs.readFileSync(path.join(installedRoot,name),'utf8').replaceAll('\r\n','\n'),normalized.get(name),name+' content must not change');
      else assert.equal(after.files[name],before.files[name],name+' bytes must not change');
    }
    const version=spawnSync(current.shim,['--version'],{env,encoding:'utf8',windowsHide:true,timeout:15000});
    assert.equal(version.status,0,version.stderr);assert.match(version.stdout,/^codex-cli /);
    console.log(`Verified ${Object.keys(after.files).length} installed files byte-for-byte; ${oldFiles.length} dependency/runtime files unchanged from 0.25.4 (${normalized.size} text files differ only in Git line endings).`);
  }finally{removeInstallationTree(os.tmpdir(),temp);}
});
