import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {root,realBinary,readJSON,settings} from './paths.mjs';

export function selectDesktopRuntime(parentExecutable,configuredExecutable,fallback){
  const app=parentExecutable?.split('/Contents/MacOS/')[0];
  if(!parentExecutable?.includes('/Contents/MacOS/'))return {binary:fallback,desktop:false};
  const binary=path.join(app,'Contents/Resources/codex-cli/bin/codex');
  return fs.existsSync(binary)?{binary,desktop:true}:{binary:fallback,desktop:false};
}
export function callerRuntime(){
  const fallback=realBinary();
  if(process.platform!=='darwin'||!readJSON(path.join(root,'automatic-startup.json')))return {binary:fallback,desktop:true};
  const parent=spawnSync('/bin/ps',['-p',String(process.ppid),'-o','comm='],{encoding:'utf8',timeout:2000}).stdout?.trim();
  return selectDesktopRuntime(parent,settings().desktopExecutable,fallback);
}
