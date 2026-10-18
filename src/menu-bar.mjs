import fs from 'node:fs';
import {canonicalLocalPath} from './local-path.mjs';
import path from 'node:path';
import {spawnSync,spawn} from 'node:child_process';
import {root,settings,readJSON} from './paths.mjs';
import {windows,processInfo} from './platform/index.mjs';

export function menuBarProcess(app=settings().installedApp){
  if(windows){const s=readJSON(path.join(root,'ui-status.json'),{});if(!app||!Number.isSafeInteger(s.pid))return null;const info=processInfo(s.pid);return info?.executable&&canonicalLocalPath(info.executable).toLowerCase()===canonicalLocalPath(app).toLowerCase()?s.pid:null;}
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
  return {running:pid!=null,created:current&&status.menuReady===true,ready:current&&status.menuReady===true&&status.menuWindowVisible===true&&status.menuOnScreen===true,windowVisible:current&&status.windowVisible===true,bundleIdentifier:current?status.bundleIdentifier:null,menuFrame:current?status.menuFrame:null};
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
  if(windows){const p=spawn(app,['--quit'],{windowsHide:true,stdio:'ignore',env:process.env});p.on('error',()=>{});p.unref();for(let i=0;i<40;i++){try{process.kill(pid,0);}catch{return;}await new Promise(r=>setTimeout(r,100));}throw Error('管理界面尚未退出，请稍后重试。');}
  try{process.kill(pid,'SIGTERM');}catch{return;}
  // Wait before replacing/reopening the bundle: Launch Services can otherwise
  // route the open request to the old process while it is still terminating.
  for(let attempt=0;attempt<40;attempt++){
    if(menuBarProcess(app)!==pid)return;
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  throw new Error('菜单栏界面尚未退出，暂未替换应用。');
}
