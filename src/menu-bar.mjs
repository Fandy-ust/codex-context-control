import {ownedWindowsMenuProcess} from './platform/windows-menu-process.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync,spawn} from 'node:child_process';
import {root,settings,readJSON} from './paths.mjs';
import {windows,processInfo} from './platform/index.mjs';

export function menuBarProcess(app=settings().installedApp){
  if(windows){const status=readJSON(path.join(root,'ui-status.json'),{});if(!Number.isSafeInteger(status.pid)||status.pid<=1)return null;return ownedWindowsMenuProcess({app,installBase:settings().installBase,status,info:processInfo(status.pid)});}
  if(process.platform!=='darwin'||!app)return null;
  const installed=path.join(app,'Contents/MacOS/ContextControl-native');
  let executable=fs.existsSync(installed)?installed:path.join(app,'Contents/MacOS/ContextControl');
  try{executable=fs.realpathSync(executable);}catch{return null;}
  // Launch Services may canonicalize /tmp and rewrite argv[0]; use the executable path.
  const result=spawnSync('/bin/ps',['-axo','pid=,comm='],{encoding:'utf8',timeout:2000});
  for(const line of (result.stdout||'').split('\n')){
    const match=line.match(/^\s*(\d+)\s+(.+)$/);
    if(match&&match[2]===executable)return Number(match[1]);
  }
  return null;
}
export function menuBarStatus(){
  const pid=menuBarProcess();const status=readJSON(path.join(root,'ui-status.json'),{});
  const current=pid!=null&&status.pid===pid;
  // AppKit reports an existing image/window even when Control Center hides its
  // host. Do not present process health or client-window coordinates as proof
  // that the user can see the icon.
  return {running:pid!=null,created:current&&status.menuReady===true,imageReady:current&&status.menuImageReady===true,ready:current?null:false,visibilityEvidence:current?'unverified':'not_running',windowVisible:current&&status.windowVisible===true,bundleIdentifier:current?status.bundleIdentifier:null,menuFrame:current?status.menuFrame:null};
}
export function ensureMenuBarEntry(app=settings().installedApp,controlHome=root){
  if(windows){if(!app||!fs.existsSync(app))return {started:false};if(menuBarProcess(app))return {started:false,alreadyRunning:true};const p=spawn(app,['--background'],{cwd:path.dirname(app),windowsHide:true,detached:true,stdio:'ignore',env:{...process.env,CONTEXT_CONTROL_HOME:controlHome}});p.on('error',()=>{});p.unref();return {started:true};}
  if(process.platform!=='darwin'||!app||!fs.existsSync(app))return {started:false};
  if(menuBarProcess(app))return {started:false,alreadyRunning:true};
  // Wait for Launch Services to accept the request before a short-lived
  // installer exits. The application itself remains independently running.
  const launched=spawnSync('/usr/bin/open',['-g','-a',app,'--env',`CONTEXT_CONTROL_HOME=${controlHome}`,'--args','--background'],{encoding:'utf8',timeout:5000});
  return launched.status===0?{started:true}:{started:false,error:launched.error?.message||launched.stderr?.trim()||'无法启动菜单栏界面'};
}
export async function stopMenuBarEntry(app=settings().installedApp){
  const pid=menuBarProcess(app);if(!pid)return;
  if(windows){const executable=processInfo(pid)?.executable;if(!executable)throw Error('无法确认旧管理界面，请稍后重试。');const p=spawn(executable,['--quit'],{windowsHide:true,stdio:'ignore',env:{...process.env,CONTEXT_CONTROL_HOME:root}});p.on('error',()=>{});p.unref();for(let i=0;i<40;i++){try{process.kill(pid,0);}catch{return;}await new Promise(r=>setTimeout(r,100));}throw Error('管理界面尚未退出，请稍后重试。');}
  try{process.kill(pid,'SIGTERM');}catch{return;}
  // Wait before replacing/reopening the bundle: Launch Services can otherwise
  // route the open request to the old process while it is still terminating.
  for(let attempt=0;attempt<40;attempt++){
    if(menuBarProcess(app)!==pid)return;
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  throw new Error('菜单栏界面尚未退出，暂未替换应用。');
}
