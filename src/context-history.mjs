import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {canonicalLocalPath,pathInside} from './local-path.mjs';

const latestDatabase=home=>fs.readdirSync(home).filter(n=>/^state_\d+\.sqlite$/.test(n)).sort((a,b)=>Number(b.match(/\d+/)[0])-Number(a.match(/\d+/)[0]))[0];
const fingerprint=stat=>`${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
// A small dependency list outlives the bounded parsed-history cache. Unchanged
// large/forked histories must not be reparsed just because their events were evicted.
export function historySourcesUnchanged(home,sources){
  if(!sources?.length)return false;let db;
  try{
    const name=latestDatabase(home);if(!name)return false;
    db=new DatabaseSync(path.join(home,name),{readOnly:true});
    const query=db.prepare('SELECT rollout_path FROM threads WHERE id=?');
    return sources.every(source=>{
      const row=query.get(source.threadId);if(!row?.rollout_path)return false;
      const file=canonicalLocalPath(row.rollout_path);
      return file===source.file&&fingerprint(fs.statSync(file))===source.fingerprint;
    });
  }catch{return false;}finally{db?.close();}
}
export function createHistoryCache({maxBytes=64*1024*1024,maxFiles=4,projectEvent=null}={}){
  return {files:new Map(),serial:0,maxBytes,maxFiles,projectEvent,metrics:{bytesRead:0,parsedLines:0,fullReads:0,appendReads:0,hits:0,retainedBytes:0}};
}
export function readHistory(home,id,cache=null){
  if(!/^[a-f\d-]{36}$/i.test(id))throw new Error('聊天 ID 无效');
  const database=latestDatabase(home);
  if(!database)throw new Error('尚未找到本地聊天记录');
  const db=new DatabaseSync(path.join(home,database),{readOnly:true});let bytes=0;const dependencies=[],sources=[];
  const root=canonicalLocalPath(home);
  function load(threadId,limit=null,seen=[]){
    if(seen.includes(threadId)||seen.length>16)throw new Error('分支继承历史异常');
    const row=db.prepare('SELECT rollout_path FROM threads WHERE id=?').get(threadId);
    if(!row?.rollout_path)throw new Error('这个聊天尚无本地历史，正常交互后再刷新');
    const file=canonicalLocalPath(row.rollout_path);
    if(!pathInside(root,file)||!file.endsWith('.jsonl'))throw new Error('聊天记录不在本地 Codex 目录内');
    const stat=fs.statSync(file),size=stat.size,n=limit??size;
    if(!Number.isSafeInteger(n)||n<0||n>size||n>128*1024*1024||(bytes+=n)>256*1024*1024)throw new Error('历史大小或分支边界无法安全读取');
    const key=`${threadId}:${file}:${limit??'live'}`;
    const stamp=fingerprint(stat);sources.push({threadId,file,fingerprint:stamp});
    const previous=cache?.files.get(key);let entry;
    if(previous?.fingerprint===stamp){entry=previous;cache.metrics.hits++;}
    else {
      // Native rollouts append complete records. Replacements, truncations and
      // same-size edits rebuild; explicit refresh clears this cache as well.
      const append=limit==null&&previous&&previous.ino===stat.ino&&previous.dev===stat.dev&&size>previous.size;
      const start=append?previous.completeBytes:0;
      const fd=fs.openSync(file,'r'),buffer=Buffer.alloc(n-start);
      try {let read=0;while(read<buffer.length){const count=fs.readSync(fd,buffer,read,buffer.length-read,start+read);if(!count)throw new Error('历史在读取期间改变，请刷新');read+=count;}}
      finally {fs.closeSync(fd);}
      const complete=buffer.lastIndexOf(10)+1;
      if(limit!=null&&complete!==buffer.length)throw new Error('继承边界不是完整记录');
      let added;try{added=buffer.subarray(0,complete).toString('utf8').split('\n').filter(Boolean).map(line=>{const event={...JSON.parse(line),originThreadId:threadId};return cache?.projectEvent?cache.projectEvent(event):event;});}catch{throw new Error('本地历史记录解析失败');}
      const local=append?[...previous.events,...added]:added;
      if(local[0]?.type!=='session_meta')throw new Error('聊天元数据缺失');
      const retainedBytes=(append?previous.retainedBytes:0)+(cache?.projectEvent?Buffer.byteLength(JSON.stringify(added)):complete);
      entry={events:local,retainedBytes,completeBytes:start+complete,size,ino:stat.ino,dev:stat.dev,fingerprint:stamp,revision:append&&added.length===0?previous.revision:cache?++cache.serial:0};
      if(cache){cache.metrics.bytesRead+=buffer.length;cache.metrics.parsedLines+=added.length;cache.metrics[append?'appendReads':'fullReads']++;}
    }
    if(cache){
      cache.files.delete(key);cache.files.set(key,entry);
      let retained=[...cache.files.values()].reduce((sum,x)=>sum+x.retainedBytes,0);
      while(cache.files.size>cache.maxFiles||retained>cache.maxBytes){const oldest=cache.files.keys().next().value;retained-=cache.files.get(oldest).retainedBytes;cache.files.delete(oldest);}
      cache.metrics.retainedBytes=retained;
      dependencies.push([key,entry.revision]);
    }
    const base=entry.events[0].payload.history_base;let inherited=[];
    if(base){
      if(!Number.isSafeInteger(base.end_byte_offset)||!Number.isSafeInteger(base.end_ordinal_exclusive))throw new Error('继承边界缺失');
      inherited=load(base.thread_id,base.end_byte_offset,[...seen,threadId]);
      if(inherited.length!==base.end_ordinal_exclusive)throw new Error('继承历史的字节与条目边界不一致');
    }
    return [...inherited,...entry.events];
  }
  try {const events=load(id);Object.defineProperties(events,{revision:{value:JSON.stringify(dependencies)},sources:{value:sources}});return events;}
  finally {db.close();}
}
