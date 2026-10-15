import fs from 'node:fs';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
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
  return {running:pid!=null,ready:pid!=null&&status.pid===pid&&status.menuReady===true,windowVisible:pid!=null&&status.pid===pid&&status.windowVisible===true};
}
export function ensureMenuBarEntry(app=settings().installedApp,controlHome=root){
  if(process.platform!=='darwin'||!app||!fs.existsSync(app))return {started:false};
  if(menuBarProcess(app))return {started:false,alreadyRunning:true};
  const child=spawn('/usr/bin/open',['-g','-a',app,'--env',`CONTEXT_CONTROL_HOME=${controlHome}`,'--args','--background'],{stdio:'ignore'});
  child.once('error',()=>{});child.unref();return {started:true};
}
export function stopMenuBarEntry(app=settings().installedApp){
  const pid=menuBarProcess(app);if(pid)try{process.kill(pid,'SIGTERM');}catch{}
}
