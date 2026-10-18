import os from 'node:os';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('install, reinstall and uninstall preserve unrelated hooks and never create trust',{skip:process.env.CONTEXT_CONTROL_TEST_INSTALL!=='1'||process.platform!=='darwin',timeout:120000},()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-install-'));const repo=fileURLToPath(new URL('../',import.meta.url));
  const home=path.join(temp,'codex');fs.mkdirSync(home);
  // Installation checks need an application layout, not a real model runtime or installed Codex.
  const contents=path.join(temp,'Fixture Codex.app/Contents');
  const binary=path.join(contents,'Resources/codex-cli/bin/codex');
  fs.mkdirSync(path.dirname(binary),{recursive:true});fs.mkdirSync(path.join(contents,'MacOS'));
  fs.writeFileSync(binary,'#!/bin/sh\nprintf "codex-cli 0.160.0\\n"\n',{mode:0o700});
  fs.writeFileSync(path.join(contents,'MacOS/FixtureDesktop'),'#!/bin/sh\nexit 0\n',{mode:0o700});
  fs.writeFileSync(path.join(contents,'Info.plist'),'<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>FixtureDesktop</string><key>CFBundleIdentifier</key><string>io.github.codex-context-control.fixture-desktop</string></dict></plist>');
  const existing={description:'Keep me',hooks:{Stop:[{hooks:[{type:'command',command:'/existing/speed-hook',timeout:15}]},{hooks:[]}],SessionStart:[{hooks:[{type:'command',command:'/existing/start'}]}]}};
  fs.writeFileSync(path.join(home,'hooks.json'),JSON.stringify(existing));fs.writeFileSync(path.join(home,'config.toml'),'model_context_window=1000000\n');
  const env={...process.env,CONTEXT_CONTROL_HOME:path.join(temp,'control'),CONTEXT_CONTROL_CODEX_HOME:home,CONTEXT_CONTROL_APPLICATIONS:path.join(temp,'Applications'),CONTEXT_CONTROL_REAL_CODEX:binary};
  const run=args=>{const p=spawnSync(process.execPath,[path.join(repo,'scripts/install.mjs'),...args],{env,encoding:'utf8'});assert.equal(p.status,0,p.stderr);};
  try{
    run(['--no-auto-start','--use-built-panel']);
    const extension=path.join(temp,'control/context-extension.json');assert.equal(fs.existsSync(extension),false,'fresh installs leave extension disabled');
    const oldPackage=path.join(temp,'control/code/package.json');const metadata=JSON.parse(fs.readFileSync(oldPackage));metadata.version='0.13.0';fs.writeFileSync(oldPackage,JSON.stringify(metadata));
    run(['--no-auto-start','--use-built-panel']);assert.equal(JSON.parse(fs.readFileSync(extension)).enabled,true,'upgrades preserve previously enabled extension');
    fs.writeFileSync(extension,JSON.stringify({enabled:false}));run(['--no-auto-start','--use-built-panel']);assert.equal(JSON.parse(fs.readFileSync(extension)).enabled,false,'explicit off survives reinstall');
    const installed=JSON.parse(fs.readFileSync(path.join(home,'hooks.json'),'utf8'));
    assert.deepEqual(installed.hooks.Stop.slice(0,2),existing.hooks.Stop);assert.deepEqual(installed.hooks.SessionStart,existing.hooks.SessionStart);assert.equal(installed.hooks.Stop.length,3);
    assert.equal(fs.readFileSync(path.join(home,'config.toml'),'utf8'),'model_context_window=1000000\n');
    assert.ok(fs.existsSync(path.join(temp,'control/code/node_modules/js-tiktoken/package.json')));
    const app=path.join(temp,'Applications/Codex Context Control.app');
    const executable=path.join(app,'Contents/MacOS/ContextControl');
    assert.ok(fs.existsSync(executable));assert.equal(fs.existsSync(executable+'-native'),false);
    assert.match(spawnSync('/usr/bin/file',[executable],{encoding:'utf8'}).stdout,/Mach-O/);
    const verified=spawnSync('/usr/bin/codesign',['--verify','--strict',app],{encoding:'utf8'});assert.equal(verified.status,0,verified.stderr);
    assert.equal(JSON.parse(fs.readFileSync(path.join(temp,'control/settings.json'),'utf8')).desktopBundleId,'io.github.codex-context-control.fixture-desktop');
    run(['--uninstall']);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home,'hooks.json'),'utf8')),existing);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
