import fs from 'node:fs';
import {windows} from './platform/index.mjs';
import {cleanupWindowsInstallations} from './platform/windows-cleanup.mjs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {root,readJSON,atomicJSON} from './paths.mjs';
const nodeName=/^node-(v\d+\.\d+\.\d+)-(arm64|x64)-[a-f0-9]{12}(?:\.exe)?$/;
const licenseName=/^Node-(v\d+\.\d+\.\d+)-LICENSE\.txt$/;
const pin=JSON.parse(fs.readFileSync(new URL('../runtime-patches/manifest.json',import.meta.url)));
export function processExecutables(){
 const r=spawnSync('/bin/ps',['-axo','comm='],{encoding:'utf8',timeout:5000,maxBuffer:8*1024*1024});
 if(r.error||r.status!==0||!r.stdout.trim())return null;
 return r.stdout.split('\n').map(s=>s.trim()).filter(Boolean);
}
function resourceInUse(file,directory=false){
 const r=spawnSync('/usr/sbin/lsof',['-n','-P','-F','n',...(directory?['+D',file]:[file])],{encoding:'utf8',timeout:10000,maxBuffer:8*1024*1024});
 // lsof exits 1 with no output when no process has this resource open.
 return !!r.error||r.status!==1||!!r.stdout.trim()||!!r.stderr.trim();
}
// Only remove installation-owned files after a successful update. Running
// binaries and their resources remain until a later cleanup pass.
export function cleanupOldRuntimes(options={}){return windows?cleanupWindowsInstallations({home:root,...options}):cleanupMacRuntimes(options);}
export function cleanupMacRuntimes({home=root,activeExecutables=processExecutables(),inUse=resourceInUse,currentNode=readJSON(path.join(home,'settings.json'),{})?.node}={}){
 const result={removed:[],deferred:[]};
 if(!Array.isArray(activeExecutables)||!currentNode||!fs.existsSync(currentNode))return result;
 const canonical=p=>{try{return fs.realpathSync(p);}catch{return p;}};
 const active=new Set([...activeExecutables,process.execPath,currentNode].map(canonical));
 const directory=path.join(home,'runtime');
 const ordinaryDirectory=p=>{try{const stat=fs.lstatSync(p);return stat.isDirectory()&&!stat.isSymbolicLink();}catch{return false;}};
 if(ordinaryDirectory(directory)){
  for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
   if(!entry.isFile()||!nodeName.test(entry.name))continue;
   const file=path.join(directory,entry.name);
   if(active.has(canonical(file))||inUse(file)){if(canonical(file)!==canonical(currentNode))result.deferred.push(file);continue;}
   try{fs.unlinkSync(file);result.removed.push(file);}catch{/* Retry next time. */}
  }
  const keptVersions=new Set(fs.readdirSync(directory).map(n=>n.match(nodeName)?.[1]).filter(Boolean));
  for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
   const version=entry.name.match(licenseName)?.[1];if(!entry.isFile()||!version||keptVersions.has(version))continue;
   const file=path.join(directory,entry.name);try{fs.unlinkSync(file);result.removed.push(file);}catch{}
  }
 }
 const legacyRoot=path.join(home,'runtimes'),legacy=path.join(legacyRoot,pin.id);
 // Do not touch unknown runtime packages, user backups, or symlink targets.
 if(readJSON(path.join(home,'runtime-fix.json'),{})?.enabled===false&&ordinaryDirectory(legacyRoot)&&ordinaryDirectory(legacy)){
  const manifest=readJSON(path.join(legacy,'runtime.json'),{});
  if(manifest.id===pin.id){
   if([...active].some(p=>p===canonical(legacy)||p.startsWith(canonical(legacy)+path.sep))||inUse(legacy,true))result.deferred.push(legacy);
   else{try{fs.rmSync(legacy,{recursive:true,force:false});result.removed.push(legacy);}catch{}}
  }
 }
 const updateFile=path.join(home,'updates.json'),update=readJSON(updateFile,{}),pending=update?.cleanupPending;
 if(typeof pending==='string'&&path.dirname(pending)===home&&/^update-[A-Za-z0-9]{6}$/.test(path.basename(pending))&&ordinaryDirectory(pending)){
  let busy=false;if(Number.isSafeInteger(update.pid)&&update.pid>0){try{process.kill(update.pid,0);busy=true;}catch{}}
  if(!busy&&![...active].some(p=>p.startsWith(canonical(pending)+path.sep))){
   const volume=path.join(pending,'volume');let removable=true;
   if(ordinaryDirectory(volume)&&fs.statSync(volume).dev!==fs.statSync(pending).dev){const detached=spawnSync('/usr/bin/hdiutil',['detach',volume],{encoding:'utf8',timeout:10000});removable=!detached.error&&detached.status===0;}
   if(removable){try{fs.rmSync(pending,{recursive:true,force:false});atomicJSON(updateFile,{...update,cleanupPending:null});result.removed.push(pending);}catch{}}
  }
 }
 return result;
}
