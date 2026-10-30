import {retainedCalendarPoints} from './backup-retention.mjs';
import {storeBlocks,loadBlocks,collectBlocks,treeBytes} from './backup-blocks.mjs';
import {gzipSync} from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {DatabaseSync,backup} from 'node:sqlite';
import {parse as parseTOML} from 'smol-toml';
import {durableWrite} from './durable-files.mjs';

const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const text=b=>new TextDecoder('utf-8',{fatal:true}).decode(b);
function validate(name,bytes){
 if(!bytes.length||bytes.includes(0))throw Error('Empty or zero-filled file');
 if(name==='config.toml')parseTOML(text(bytes));
 else if(name.endsWith('.json')){const value=JSON.parse(text(bytes));if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid global state');}
}
function checkDB(file){const db=new DatabaseSync(file,{readOnly:true});try{if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw Error('SQLite integrity check failed');}finally{db.close();}}
export function validateProtectedFile(name,file){if(name.endsWith('.sqlite'))checkDB(file);else validate(name,fs.readFileSync(file));}
const names=home=>[...['config.toml','.codex-global-state.json'].filter(n=>fs.existsSync(path.join(home,n))),...fs.readdirSync(home).filter(n=>/^state_\d+\.sqlite$/.test(n))];
export class CodexPowerProtection {
 constructor({home,directory,isRunning,now=()=>new Date(),maxBytes=200*1024*1024,monthlyMonths=3}){Object.assign(this,{home,directory,isRunning,now,maxBytes,monthlyMonths});this.busy=false;}
 generations(tier){const dir=path.join(this.directory,tier);try{return fs.readdirSync(dir).filter(n=>/^\d+-[a-f0-9]+$/.test(n)).sort().reverse().map(n=>path.join(dir,n));}catch{return [];}}
 candidate(name){for(const dir of [...this.generations('recent'),...this.generations('daily')]){let check;try{const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'))),entry=manifest.files[name];if(!entry)continue;const bytes=loadBlocks(path.join(path.dirname(dir),'blocks'),entry);if(name.endsWith('.sqlite')){check=path.join(this.directory,'.check-'+crypto.randomBytes(8).toString('hex'));durableWrite(check,bytes);checkDB(check);}else validate(name,bytes);return bytes;}catch{}finally{if(check)fs.rmSync(check,{force:true});}}return null;}
 prune(){
  const collect=()=>{for(const tier of ['recent','daily'])collectBlocks(path.join(this.directory,tier,'blocks'),this.generations(tier));};
  // Keep the freshest working point plus calendar-spaced historical points.
  for(const dir of this.generations('recent').slice(1))fs.rmSync(dir,{recursive:true,force:true});
  const points=this.generations('daily').map(id=>{try{return {id,at:JSON.parse(fs.readFileSync(path.join(id,'manifest.json'))).at};}catch{return {id,at:''};}});
  const retained=retainedCalendarPoints(points,this.now(),{monthlyMonths:this.monthlyMonths});
  for(const {id} of points)if(!retained.has(id))fs.rmSync(id,{recursive:true,force:true});
  collect();
  const damaged=path.join(this.directory,'damaged');try{for(const name of fs.readdirSync(damaged).sort().slice(0,-2))fs.rmSync(path.join(damaged,name),{recursive:true,force:true});}catch{}
  while(treeBytes(this.directory)>this.maxBytes-4096){
   let removed=false;try{const old=fs.readdirSync(damaged).sort()[0];if(old){fs.rmSync(path.join(damaged,old),{recursive:true,force:true});removed=true;}}catch{}
   if(removed)continue;
   const removable=['recent','daily'].flatMap(t=>this.generations(t).slice(1)).sort();
   if(!removable.length)break;fs.rmSync(removable[0],{recursive:true,force:true});collect();
  }
 }
 async tick(){
 if(this.busy||this.hold?.())return;this.busy=true;
 const status={at:this.now().toISOString(),pending:[],restored:[],errors:[]};
 try{
  fs.mkdirSync(this.home,{recursive:true,mode:0o700});fs.mkdirSync(this.directory,{recursive:true,mode:0o700});
  for(const name of fs.readdirSync(this.directory))if(/^\.stage-[a-f0-9]+$/.test(name))fs.rmSync(path.join(this.directory,name),{recursive:true,force:true});
  const protectedNames=new Set(names(this.home));
  for(const dir of [...this.generations('recent'),...this.generations('daily')])try{for(const name of Object.keys(JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'))).files))if(name==='config.toml'||name==='.codex-global-state.json'||/^state_\d+\.sqlite$/.test(name))protectedNames.add(name);}catch{}
  for(const name of protectedNames){const file=path.join(this.home,name);let damaged;
   try{if(name.endsWith('.sqlite'))checkDB(file);else validate(name,fs.readFileSync(file));continue;}catch(error){damaged=error.message;}
   const bytes=this.candidate(name);if(!bytes){status.errors.push({name,error:damaged,backup:false});continue;}
   // Never restore files while desktop, CLI or app-server can have cached state.
   if(await this.isRunning()){status.pending.push(name);continue;}
   const quarantine=path.join(this.directory,'damaged',String(this.now().getTime()));
   for(const suffix of name.endsWith('.sqlite')?['','-wal','-shm']:['']){const target=file+suffix;if(fs.existsSync(target))durableWrite(path.join(quarantine,name+suffix),fs.readFileSync(target));}
   if(await this.isRunning()){status.pending.push(name);continue;}
   if(name.endsWith('.sqlite'))for(const suffix of ['-wal','-shm'])fs.rmSync(file+suffix,{force:true});
   durableWrite(file,bytes);status.restored.push(name);
  }
  // Do not replace known good snapshots with an incomplete/corrupt source set.
  if(status.pending.length||status.errors.length)return status;
  const fingerprint=[...protectedNames].sort().flatMap(name=>[name,...(name.endsWith('.sqlite')?[name+'-wal']:[])]).map(name=>{try{const st=fs.statSync(path.join(this.home,name));return [name,st.size,st.mtimeMs,st.ctimeMs];}catch{return [name];}});
  const clock=this.now(),signature=JSON.stringify(fingerprint),dayKey=[clock.getFullYear(),clock.getMonth(),clock.getDate()].join('-');
  if(this.signature===signature&&this.dayKey===dayKey){status.unchanged=true;return status;}
  const stage=path.join(this.directory,'.stage-'+crypto.randomBytes(8).toString('hex'));fs.mkdirSync(stage,{mode:0o700});
  try{
   const manifest={at:status.at,files:{}};
   for(const name of protectedNames){const source=path.join(this.home,name),target=path.join(stage,name);if(!fs.existsSync(source))continue;
    if(name.endsWith('.sqlite')){const db=new DatabaseSync(source,{readOnly:true});try{await backup(db,target);}finally{db.close();}checkDB(target);const fd=fs.openSync(target,'r+');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
    else{const bytes=fs.readFileSync(source);validate(name,bytes);durableWrite(target,bytes);}
    manifest.files[name]={sha256:digest(fs.readFileSync(target))};
   }
   if(!Object.keys(manifest.files).length)return status;
   durableWrite(path.join(stage,'manifest.json'),JSON.stringify(manifest));
   let compressedBytes=0;for(const name of Object.keys(manifest.files)){const bytes=fs.readFileSync(path.join(stage,name));for(let at=0;at<bytes.length;at+=65536)compressedBytes+=gzipSync(bytes.subarray(at,at+65536)).length;}
   if(compressedBytes>this.maxBytes/3)throw Error('Snapshot exceeds backup capacity; existing recovery points retained');
   const id=this.now().getTime()+'-'+crypto.randomBytes(4).toString('hex');
   const publish=tier=>{const dir=path.join(this.directory,tier);fs.mkdirSync(dir,{recursive:true,mode:0o700});const dest=path.join(dir,id),index={at:manifest.at,files:{}};
    for(const name of Object.keys(manifest.files))index.files[name]=storeBlocks(path.join(dir,'blocks'),fs.readFileSync(path.join(stage,name)));
    // Publish only after all blocks have reached disk. Daily has a separate block pool.
    fs.mkdirSync(dest,{mode:0o700});durableWrite(path.join(dest,'manifest.json'),JSON.stringify(index));};
   publish('recent');
   publish('daily');
   status.snapshotAt=status.at;this.signature=signature;this.dayKey=dayKey;
  }finally{fs.rmSync(stage,{recursive:true,force:true});}
  return status;
 }catch(error){status.errors.push({error:error.message});return status;}
 finally{this.busy=false;if(!status.pending.length&&this.retryTimer){clearTimeout(this.retryTimer);this.retryTimer=null;}if(status.pending.length&&!this.retryTimer){this.retryTimer=setTimeout(()=>{this.retryTimer=null;void this.tick();},5000);this.retryTimer.unref();}try{this.prune();status.storedBytes=treeBytes(this.directory);durableWrite(path.join(this.directory,'status.json'),JSON.stringify(status));}catch(error){process.stderr.write('Power protection: '+error.message+'\n');}}
 }
 start(){void this.tick();const timer=setInterval(()=>void this.tick(),300000);timer.unref();return timer;}
}
