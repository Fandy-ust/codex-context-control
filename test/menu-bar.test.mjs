import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';

test('a desktop connection automatically creates a menu entry without opening a window or duplicating on reconnect',{
  skip:process.platform!=='darwin'||process.env.CONTEXT_CONTROL_TEST_UI!=='1',timeout:30000
},async()=>{
  const temp=fs.mkdtempSync('/tmp/ctc-menu-'),control=path.join(temp,'control');
  process.env.CONTEXT_CONTROL_HOME=control;process.env.CONTEXT_CONTROL_CODEX_HOME=path.join(temp,'codex');
  const repo=fileURLToPath(new URL('../',import.meta.url)),app=path.join(temp,'Menu Probe.app');
  fs.mkdirSync(control);fs.mkdirSync(process.env.CONTEXT_CONTROL_CODEX_HOME);
  fs.cpSync(path.join(repo,'build/Codex Context Control.app'),app,{recursive:true});
  const bundleId='io.github.codex-context-control.ui-probe.'+randomUUID();
  const changed=spawnSync('/usr/libexec/PlistBuddy',['-c','Set :CFBundleIdentifier '+bundleId,path.join(app,'Contents/Info.plist')],{encoding:'utf8'});assert.equal(changed.status,0,changed.stderr);
  const signed=spawnSync('/usr/bin/codesign',['--force','--sign','-',app],{encoding:'utf8'});assert.equal(signed.status,0,signed.stderr);
  const nodeStub=path.join(control,'node-stub');fs.writeFileSync(nodeStub,'#!/bin/sh\nprintf \'%s\\n\' "$@" > "$CONTEXT_CONTROL_HOME/service-started"\n',{mode:0o700});
  fs.mkdirSync(path.join(control,'code/src'),{recursive:true});fs.writeFileSync(path.join(control,'code/src/cli.mjs'),'');
  fs.writeFileSync(path.join(control,'settings.json'),JSON.stringify({installedApp:app,node:nodeStub}));
  const {startDaemon}=await import('../src/daemon.mjs');const {connect,request}=await import('../src/ipc.mjs');
  const {ensureMenuBarEntry,stopMenuBarEntry}=await import('../src/menu-bar.mjs');
  const daemon=await startDaemon();let peer;
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  async function until(fn){for(let n=0;n<150;n++){try{const result=await fn();if(result)return result;}catch{}await sleep(50);}throw new Error('menu entry did not become ready');}
  const status=()=>JSON.parse(fs.readFileSync(path.join(control,'ui-status.json'),'utf8'));
  try{
    peer=await connect(()=>({}));await peer.call('registerBridge',{pid:process.pid});
    const first=await until(()=>{const s=status();return s.menuReady&&s.bridgeCount===1?s:false;});
    assert.equal(first.statusTitle,'');
    assert.equal(first.startedInBackground,true);assert.equal(first.windowVisible,false);
    assert.equal(first.bundleIdentifier,bundleId);
    assert.equal(await until(()=>fs.existsSync(path.join(control,'service-started'))),true);
    assert.equal(fs.readFileSync(path.join(control,'service-started'),'utf8'),path.join(control,'code/src/cli.mjs')+'\nstart\n');
    assert.equal(ensureMenuBarEntry(app,control).alreadyRunning,true);
    peer.close();await until(async()=>(await request('state')).bridgeCount===0);
    peer=await connect(()=>({}));await peer.call('registerBridge',{pid:process.pid});await sleep(250);
    assert.equal(status().pid,first.pid);assert.equal(status().windowVisible,false);
    await stopMenuBarEntry(app);
    const launcher=spawnSync(process.execPath,['--input-type=module','-e',`import {ensureMenuBarEntry} from ${JSON.stringify(new URL('../src/menu-bar.mjs',import.meta.url).href)};const result=ensureMenuBarEntry(${JSON.stringify(app)},${JSON.stringify(control)});if(!result.started)throw new Error(JSON.stringify(result));`],{env:process.env,encoding:'utf8'});
    assert.equal(launcher.status,0,launcher.stderr);
    const restarted=await until(()=>{const s=status();return s.pid!==first.pid&&s.menuReady&&s.bridgeCount===1?s:false;});
    assert.equal(restarted.startedInBackground,true);assert.equal(restarted.windowVisible,false);
  }finally{
    peer?.close();await stopMenuBarEntry(app);
    spawnSync('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister',['-u',app],{stdio:'ignore'});
    await new Promise(r=>daemon.ipcServer.close(r));daemon.web.closeAllConnections();await new Promise(r=>daemon.web.close(r));
    await sleep(100);fs.rmSync(temp,{recursive:true,force:true});
  }
});
