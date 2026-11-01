import fs from 'node:fs';
import {canonicalLocalPath,pathInside} from './local-path.mjs';
import {resolveRolloutPath,readRolloutChunks,isRolloutPath} from './rollout-file.mjs';

// Native session headers are immutable after creation. Read only the bounded
// first record, never the conversation or the history_base ancestor (which can
// differ from the actual fork parent after several forks).
export function readForkParent(home,id,file,cache,{includeCompressed=false}={}){
  if(typeof file!=='string')return null;
  try{
    const real=canonicalLocalPath(resolveRolloutPath(file));
    if(!pathInside(canonicalLocalPath(home),real)||!isRolloutPath(real))return null;
    // Metadata discovery visits all chats. Cold headers are decoded only for
    // an explicit selected-chat read, never as a startup-wide migration.
    if(real.endsWith('.zst')&&!includeCompressed)return null;
    const stat=fs.statSync(real),key=`${real}:${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
    const previous=cache.get(id);
    if(previous?.key===key&&stat.size>=previous.bytes)return previous.parent;
    if(real.endsWith('.zst')){
      let parts=[],bytes=0,parent=null;const done={};
      try{readRolloutChunks(real,{maxBytes:1024*1024},chunk=>{
        const end=chunk.indexOf(10),part=end<0?chunk:chunk.subarray(0,end);parts.push(part);bytes+=part.length;
        if(end<0)return;
        const event=JSON.parse(Buffer.concat(parts).toString('utf8')),p=event.payload;
        if(event.type==='session_meta'&&p?.id===id&&(p.thread_source==null||p.thread_source==='user')&&typeof p.forked_from_id==='string'&&/^[a-f\d-]{36}$/i.test(p.forked_from_id)&&p.forked_from_id!==id)parent=p.forked_from_id;
        throw done;
      });}catch(error){if(error!==done)throw error;}
      cache.set(id,{key,bytes:0,parent});if(cache.size>4096)cache.delete(cache.keys().next().value);return parent;
    }
    const fd=fs.openSync(real,'r'),chunks=[];let offset=0;
    try{
      while(offset<Math.min(stat.size,1024*1024)){
        const bytes=Buffer.alloc(Math.min(8192,stat.size-offset,1024*1024-offset));
        const read=fs.readSync(fd,bytes,0,bytes.length,offset);if(!read)break;
        const part=bytes.subarray(0,read),end=part.indexOf(10);
        chunks.push(end<0?part:part.subarray(0,end));offset+=read;
        if(end<0)continue;
        const event=JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if(event.type!=='session_meta'||event.payload?.id!==id)return null;
        const value=event.payload.forked_from_id;
        const userOwned=event.payload.thread_source==null||event.payload.thread_source==='user';
        const parent=userOwned&&typeof value==='string'&&/^[a-f\d-]{36}$/i.test(value)&&value!==id?value:null;
        cache.set(id,{key,bytes:Buffer.concat(chunks).length+1,parent});
        if(cache.size>4096)cache.delete(cache.keys().next().value);
        return parent;
      }
    }finally{fs.closeSync(fd);}
  }catch{/* Incomplete/missing headers are retried on the next metadata refresh. */}
  return null;
}
