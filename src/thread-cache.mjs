import fs from 'node:fs/promises';
import path from 'node:path';
import {atomicJSON,readJSON} from './paths.mjs';
import {normalizeLocalPath,pathInside} from './local-path.mjs';
const stamp=s=>`${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`;
const valid=n=>Number.isSafeInteger(n)&&n>=0;
// Persist only numeric observations, never message bodies. Initial reads are
// bounded tails; subsequent reads start at the last complete JSONL record.
export class ThreadCache {
 constructor({home,file,maxRead=256*1024}={}){
  this.home=home;this.file=file;this.maxRead=maxRead;this.metrics={bytesRead:0,hits:0,reads:0};
  try{const data=readJSON(file);this.entries=data?.version===1?data.entries??{}:{};}catch{this.entries={};}
 }
 get(id){return this.entries[id]?.summary??null;}
 async scan(rows){
  if(this.running)return this.running;
  this.running=this.run(rows).finally(()=>{this.running=null;});return this.running;
 }
 async run(rows){
  let changed=false;
  for(const row of rows){
   if(!row.rollout_path||row.archived||row.thread_source&&row.thread_source!=='user')continue;
   try{changed=(await this.read(row))||changed;}catch{/* Missing or rotating logs do not block other chats. */}
  }
  if(changed)atomicJSON(this.file,{version:1,entries:this.entries});
  return this.metrics;
 }
 async read(row){
  const [home,file]=(await Promise.all([fs.realpath(this.home),fs.realpath(row.rollout_path)])).map(normalizeLocalPath);
  if(!pathInside(home,file)||!file.endsWith('.jsonl'))return false;
  const stat=await fs.stat(file);if(!stat.isFile())return false;
  const previous=this.entries[row.id],fingerprint=stamp(stat);
  if(previous?.file===file&&previous.fingerprint===fingerprint){this.metrics.hits++;return false;}
  const append=previous?.file===file&&previous.ino===stat.ino&&previous.dev===stat.dev&&stat.size>previous.size;
  const start=append&&stat.size-previous.offset<=this.maxRead?previous.offset:Math.max(0,stat.size-this.maxRead);
  const contiguous=append&&start===previous.offset;
  const summary=contiguous?{...previous.summary}:{};
  const handle=await fs.open(file,'r');let buffer;
  try{buffer=Buffer.alloc(stat.size-start);let n=0;while(n<buffer.length){const result=await handle.read(buffer,n,buffer.length-n,start+n);if(!result.bytesRead)break;n+=result.bytesRead;}buffer=buffer.subarray(0,n);}finally{await handle.close();}
  this.metrics.bytesRead+=buffer.length;this.metrics.reads++;
  const complete=buffer.lastIndexOf(10)+1;
  // Starting in the middle of a long record must never import a partial value.
  const begin=start>0&&!contiguous?buffer.indexOf(10)+1:0;
  for(const line of buffer.subarray(begin,complete).toString('utf8').split('\n')){
   if(!line)continue;
   let event;try{event=JSON.parse(line);}catch{continue;}
   const p=event.payload??{};
   if(event.type==='compacted'||(event.type==='event_msg'&&['thread_rolled_back','thread_rollback'].includes(p.type))){summary.lastUsage=null;summary.observedWindow=null;summary.observedAt=Date.parse(event.timestamp)||Math.floor(stat.mtimeMs);}
   if(event.type==='turn_context'&&typeof p.model==='string'&&p.model.length<160)summary.model=p.model;
   if(event.type==='event_msg'&&p.type==='token_count'&&p.info){
    const info=p.info;
    if(valid(info.last_token_usage?.total_tokens)){
     summary.lastUsage={totalTokens:info.last_token_usage.total_tokens};
     summary.observedWindow=valid(info.model_context_window)&&info.model_context_window>0?info.model_context_window:null;
     const at=Date.parse(event.timestamp);summary.observedAt=Number.isFinite(at)?at:Math.floor(stat.mtimeMs);
    }
   }
  }
  this.entries[row.id]={file,fingerprint,ino:stat.ino,dev:stat.dev,size:stat.size,offset:start+complete,summary};
  return true;
 }
}
