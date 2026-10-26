import fs from 'node:fs';
import path from 'node:path';
import {atomicJSON,readJSON} from '../paths.mjs';

// A running Codex keeps the CODEX_CLI_PATH it inherited at startup. Keep its
// launcher executable in place, but point subsequent invocations at new code.
export function retargetWindowsLaunchers({home,node,codeRoot,activeShim}={}){
  const bin=path.join(home,'bin'),changed=[];
  if(!fs.existsSync(bin))return changed;
  const destination=path.resolve(codeRoot);
  try{for(const entry of fs.readdirSync(bin,{withFileTypes:true})){
    if(!entry.isDirectory()||entry.isSymbolicLink()||!/^([a-f0-9]{12})-([a-f0-9]{12})$/.test(entry.name))continue;
    const folder=path.join(bin,entry.name),exe=path.join(folder,'codex-context.exe'),file=path.join(folder,'launcher.json');
    if(!fs.existsSync(exe)||fs.lstatSync(exe).isSymbolicLink()||!fs.existsSync(file)||fs.lstatSync(file).isSymbolicLink())continue;
    const previous=readJSON(file);
    if(!previous||previous.controlHome!==home||typeof previous.codeRoot!=='string')continue;
    if(path.resolve(exe)===path.resolve(activeShim))continue;
    if(previous.node===node&&path.resolve(previous.codeRoot)===destination)continue;
    atomicJSON(file,{...previous,node,codeRoot:destination});
    changed.push({file,previous});
  }}catch(error){restoreWindowsLaunchers(changed);throw error;}
  return changed;
}

export function restoreWindowsLaunchers(changed){
  for(const {file,previous} of changed)atomicJSON(file,previous);
}
