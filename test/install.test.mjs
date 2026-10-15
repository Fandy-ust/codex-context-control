import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('install, reinstall and uninstall preserve unrelated hooks and never create trust',{skip:process.env.CONTEXT_CONTROL_TEST_INSTALL!=='1'||process.platform!=='darwin',timeout:120000},()=>{
  const temp=fs.mkdtempSync('/tmp/ctc-install-');const repo=fileURLToPath(new URL('../',import.meta.url));
  const home=path.join(temp,'codex');fs.mkdirSync(home);
  const existing={description:'Keep me',hooks:{Stop:[{hooks:[{type:'command',command:'/existing/speed-hook',timeout:15}]},{hooks:[]}],SessionStart:[{hooks:[{type:'command',command:'/existing/start'}]}]}};
  fs.writeFileSync(path.join(home,'hooks.json'),JSON.stringify(existing));fs.writeFileSync(path.join(home,'config.toml'),'model_context_window=1000000\n');
  const env={...process.env,CONTEXT_CONTROL_HOME:path.join(temp,'control'),CONTEXT_CONTROL_CODEX_HOME:home,CONTEXT_CONTROL_APPLICATIONS:path.join(temp,'Applications')};
  const run=args=>{const p=spawnSync(process.execPath,[path.join(repo,'scripts/install.mjs'),...args],{env,encoding:'utf8'});assert.equal(p.status,0,p.stderr);};
  try{
    run(['--no-auto-start','--use-built-panel']);run(['--no-auto-start','--use-built-panel']);const installed=JSON.parse(fs.readFileSync(path.join(home,'hooks.json'),'utf8'));
    assert.deepEqual(installed.hooks.Stop.slice(0,2),existing.hooks.Stop);assert.deepEqual(installed.hooks.SessionStart,existing.hooks.SessionStart);assert.equal(installed.hooks.Stop.length,3);
    assert.equal(fs.readFileSync(path.join(home,'config.toml'),'utf8'),'model_context_window=1000000\n');
    assert.ok(fs.existsSync(path.join(temp,'Applications/Codex Context Control.app/Contents/MacOS/ContextControl-native')));
    run(['--uninstall']);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home,'hooks.json'),'utf8')),existing);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
