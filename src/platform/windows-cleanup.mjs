import fs from 'node:fs';
import path from 'node:path';
import {readJSON} from '../paths.mjs';
import {canonicalLocalPath,normalizeLocalPath} from '../local-path.mjs';
import {windowsProcesses} from './windows-system.mjs';
import {verifyWindowsPayload,removeInstallationTree,sha} from './windows-install.mjs';
const versionDirectory=/^(\d+\.\d+\.\d+)-([a-f0-9]{12})$/;
const canonical=file=>{try{return canonicalLocalPath(file).toLowerCase();}catch{return normalizeLocalPath(path.resolve(file)).toLowerCase();}};
const inside=(parent,file)=>file===parent||file.startsWith(parent+path.sep);
// Do not delete code a live desktop could launch through its inherited shim.
// Cleanup is conservative when process enumeration is unavailable.
export function cleanupWindowsInstallations({home,processes=windowsProcesses(),configuration=readJSON(path.join(home,'settings.json'),{})}={}){
 const result={removed:[],deferred:[]};
 if(!Array.isArray(processes)||!configuration.installBase||!configuration.installedApp||configuration.uninstalled)return result;
 const base=path.resolve(configuration.installBase),versions=path.join(base,'versions');
 const directory=p=>{try{const s=fs.lstatSync(p);return s.isDirectory()&&!s.isSymbolicLink();}catch{return false;}};
 if(!directory(base)||!directory(versions))return result;
 const current=canonical(configuration.installedApp),desktop=configuration.desktopExecutable?canonical(configuration.desktopExecutable):null;
 const desktopRunning=processes.some(p=>p.executable&&(canonical(p.executable)===desktop||/[/\\]OpenAI\.Codex_[^/\\]+[/\\].*[/\\](ChatGPT|Codex)\.exe$/i.test(p.executable)));
 const busy=folder=>{const target=canonical(folder);return processes.some(p=>(p.executable&&inside(target,canonical(p.executable)))||(typeof p.command==='string'&&normalizeLocalPath(p.command).toLowerCase().includes(target)));};
 for(const entry of fs.readdirSync(versions,{withFileTypes:true})){
  const match=entry.name.match(versionDirectory),target=path.join(versions,entry.name);
  if(!match||!entry.isDirectory()||entry.isSymbolicLink()||inside(canonical(target),current))continue;
  if(desktopRunning||busy(target)){result.deferred.push(target);continue;}
  try{
   const file=path.join(target,'payload-manifest.json'),manifest=readJSON(file);
   if(manifest?.platform!=='win32'||manifest.version!==match[1]||sha(file).slice(0,12)!==match[2])continue;
   verifyWindowsPayload(target,{version:match[1],arch:manifest.arch});
   removeInstallationTree(base,target);result.removed.push(target);
  }catch{/* Locked, modified, or unrecognized directories remain untouched. */}
 }
 const bin=path.join(home,'bin');
 if(!desktopRunning&&directory(bin))for(const entry of fs.readdirSync(bin,{withFileTypes:true})){
  if(!entry.isDirectory()||entry.isSymbolicLink()||!/^([a-f0-9]{12})-([a-f0-9]{12})$/.test(entry.name))continue;
  const target=path.join(bin,entry.name);if(busy(target)||configuration.shim&&inside(canonical(target),canonical(configuration.shim)))continue;
  try{const launcher=readJSON(path.join(target,'launcher.json'));if(!launcher?.codeRoot||canonical(launcher.controlHome??'')!==canonical(home))continue;
   const relative=path.relative(versions,path.resolve(launcher.codeRoot));const parts=relative.split(path.sep);
   if(parts.length!==3||!versionDirectory.test(parts[0])||parts[1]!=='resources'||parts[2]!=='app')continue;
   // An old shim may have been redirected to current code while Codex ran.
   // Once Codex exits, the old shim is unused even though its codeRoot exists.
   if(fs.existsSync(path.join(versions,parts[0]))&&canonical(launcher.codeRoot)!==canonical(configuration.codeRoot||''))continue;
   removeInstallationTree(home,target);result.removed.push(target);
  }catch{}
 }
 return result;
}
