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
  const changed=spawnSync('/usr/libexec/PlistBuddy',['-c','Set :CFBundleIdentifier io.github.codex-context-control.ui-probe.'+randomUUID(),path.join(app,'Contents/Info.plist')],{encoding:'utf8'});assert.equal(changed.status,0,changed.stderr);
  fs.writeFileSync(path.join(control,'settings.json'),JSON.stringify({installedApp:app}));
  const {startDaemon}=await import('../src/daemon.mjs');const {connect,request}=await import('../src/ipc.mjs');
  const {ensureMenuBarEntry,stopMenuBarEntry}=await import('../src/menu-bar.mjs');
  const daemon=await startDaemon();let peer;
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  async function until(fn){for(let n=0;n<150;n++){try{const result=await fn();if(result)return result;}catch{}await sleep(50);}throw new Error('menu entry did not become ready');}
  const status=()=>JSON.parse(fs.readFileSync(path.join(control,'ui-status.json'),'utf8'));
  try{
    peer=await connect(()=>({}));await peer.call('registerBridge',{pid:process.pid});
    const first=await until(()=>{const s=status();return s.menuReady&&s.bridgeCount===1?s:false;});
    assert.equal(first.startedInBackground,true);assert.equal(first.windowVisible,false);
    assert.equal(ensureMenuBarEntry(app,control).alreadyRunning,true);
    peer.close();await until(async()=>(await request('state')).bridgeCount===0);
    peer=await connect(()=>({}));await peer.call('registerBridge',{pid:process.pid});await sleep(250);
    assert.equal(status().pid,first.pid);assert.equal(status().windowVisible,false);
  }finally{
    peer?.close();stopMenuBarEntry(app);
    await new Promise(r=>daemon.ipcServer.close(r));daemon.web.closeAllConnections();await new Promise(r=>daemon.web.close(r));
    await sleep(100);fs.rmSync(temp,{recursive:true,force:true});
  }
});
