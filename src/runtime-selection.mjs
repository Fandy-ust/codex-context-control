import fs from 'node:fs';
import {canonicalLocalPath} from './local-path.mjs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {root,realBinary,readJSON,settings} from './paths.mjs';
import {windows,processInfo,desktopInstallation} from './platform/index.mjs';

export function selectDesktopRuntime(parentExecutable,configuredExecutable,fallback){
  if(windows&&parentExecutable&&configuredExecutable&&fs.existsSync(parentExecutable)&&fs.existsSync(configuredExecutable)&&canonicalLocalPath(parentExecutable).toLowerCase()===canonicalLocalPath(configuredExecutable).toLowerCase()){
    const binary=path.join(path.dirname(parentExecutable),'resources/codex.exe');return fs.existsSync(binary)?{binary,desktop:true}:{binary:fallback,desktop:false};
  }
  parentExecutable=parentExecutable?.replaceAll('\\','/');
  const app=parentExecutable?.split('/Contents/MacOS/')[0];
  if(!parentExecutable?.includes('/Contents/MacOS/'))return {binary:fallback,desktop:false};
  const binary=path.join(app,'Contents/Resources/codex-cli/bin/codex');
  return fs.existsSync(binary)?{binary,desktop:true}:{binary:fallback,desktop:false};
}
export function callerRuntime(){
  const fallback=realBinary();
  if(windows&&readJSON(path.join(root,'automatic-startup.json'))){
    const registered=desktopInstallation()?.executable,configured=settings().desktopExecutable;
    let pid=process.ppid;for(let n=0;n<4&&pid>0;n++){const info=processInfo(pid);if(!info)break;for(const desktop of [registered,configured].filter(Boolean)){const selected=selectDesktopRuntime(info.executable,desktop,fallback);if(selected.desktop)return selected;}pid=info.parent;}
    return {binary:fallback,desktop:false};
  }
  if(process.platform!=='darwin'||!readJSON(path.join(root,'automatic-startup.json')))return {binary:fallback,desktop:true};
  const parent=spawnSync('/bin/ps',['-p',String(process.ppid),'-o','comm='],{encoding:'utf8',timeout:2000}).stdout?.trim();
  return selectDesktopRuntime(parent,settings().desktopExecutable,fallback);
}
