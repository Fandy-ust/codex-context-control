import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {root,settings,readJSON} from './paths.mjs';

export function menuBarProcess(app=settings().installedApp){
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
  if(process.platform!=='darwin'||!app||!fs.existsSync(app))return {started:false};
  if(menuBarProcess(app))return {started:false,alreadyRunning:true};
  // Wait for Launch Services to accept the request before a short-lived
  // installer exits. The application itself remains independently running.
  const launched=spawnSync('/usr/bin/open',['-g','-a',app,'--env',`CONTEXT_CONTROL_HOME=${controlHome}`,'--args','--background'],{encoding:'utf8',timeout:5000});
  return launched.status===0?{started:true}:{started:false,error:launched.error?.message||launched.stderr?.trim()||'无法启动菜单栏界面'};
}
export async function stopMenuBarEntry(app=settings().installedApp){
  const pid=menuBarProcess(app);if(!pid)return;
  try{process.kill(pid,'SIGTERM');}catch{return;}
  // Wait before replacing/reopening the bundle: Launch Services can otherwise
  // route the open request to the old process while it is still terminating.
  for(let attempt=0;attempt<40;attempt++){
    if(menuBarProcess(app)!==pid)return;
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  throw new Error('菜单栏界面尚未退出，暂未替换应用。');
}
