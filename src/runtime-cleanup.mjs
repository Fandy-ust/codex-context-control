import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {root,readJSON} from './paths.mjs';
const nodeName=/^node-(v\d+\.\d+\.\d+)-(arm64|x64)-[a-f0-9]{12}$/;
const licenseName=/^Node-(v\d+\.\d+\.\d+)-LICENSE\.txt$/;
const pin=JSON.parse(fs.readFileSync(new URL('../runtime-patches/manifest.json',import.meta.url)));
export function processExecutables(){
 const r=spawnSync('/bin/ps',['-axo','comm='],{encoding:'utf8',timeout:5000,maxBuffer:8*1024*1024});
 if(r.error||r.status!==0||!r.stdout.trim())return null;
 return r.stdout.split('\n').map(s=>s.trim()).filter(Boolean);
}
// Only remove installation-owned files after a successful update. Running
// binaries and their resources remain until a later cleanup pass.
export function cleanupOldRuntimes({home=root,activeExecutables=processExecutables(),currentNode=readJSON(path.join(home,'settings.json'),{})?.node}={}){
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
   if(active.has(canonical(file))||active.has('node')){if(canonical(file)!==canonical(currentNode))result.deferred.push(file);continue;}
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
   if(['codex','codex-cli','codex-code-mode-host'].some(name=>active.has(name))||[...active].some(p=>p===canonical(legacy)||p.startsWith(canonical(legacy)+path.sep)))result.deferred.push(legacy);
   else{try{fs.rmSync(legacy,{recursive:true,force:false});result.removed.push(legacy);}catch{}}
  }
 }
 return result;
}
