import fs from 'node:fs';
import {Decompress} from 'fzstd';

export const plainRolloutPath=file=>file.replace(/\.zst$/,'');
export const isRolloutPath=file=>typeof file==='string'&&/\.jsonl(?:\.zst)?$/.test(file);
export function resolveRolloutPath(file){
  if(!isRolloutPath(file))throw Error('不支持的聊天历史文件格式');
  const plain=plainRolloutPath(file);
  for(const candidate of [plain,plain+'.zst'])try{if(fs.statSync(candidate).isFile())return candidate;}catch(error){if(error.code!=='ENOENT')throw error;}
  throw Object.assign(Error('聊天历史文件不存在'),{code:'ENOENT'});
}

// Synchronous streaming preserves the existing reader API. Decoding runs in
// the bounded statistics worker; no native server, subprocess or plaintext
// copy on disk is needed. Offsets always refer to uncompressed bytes.
export function readRolloutChunks(file,{start=0,end=null,maxBytes=128*1024*1024}={},consume){
  if(!Number.isSafeInteger(start)||start<0||!Number.isSafeInteger(maxBytes)||maxBytes<0||end!=null&&(!Number.isSafeInteger(end)||end<start||end>maxBytes))throw Error('历史大小或分支边界无法安全读取');
  const compressed=file.endsWith('.zst'),fd=fs.openSync(file,'r');
  const buffer=Buffer.alloc(compressed?64*1024:1024*1024),stop={};
  let position=compressed?0:start,physicalRead=0;
  const accept=chunk=>{
    const before=position;position+=chunk.length;
    const through=Math.min(position,end??maxBytes);
    if(through>maxBytes||end==null&&position>maxBytes)throw Error('历史大小或分支边界无法安全读取');
    if(through>Math.max(start,before))consume(Buffer.from(chunk.subarray(Math.max(0,start-before),through-before)));
    if(end!=null&&position>=end)throw stop;
  };
  try{
    if(end===0)return {size:0,physicalRead:0};
    const decoder=compressed?new Decompress(accept):null;
    while(true){
      const length=compressed?buffer.length:Math.min(buffer.length,(end??maxBytes+1)-position);
      if(length<=0)break;
      const count=fs.readSync(fd,buffer,0,length,compressed?null:position);
      if(!count){if(decoder)decoder.push(new Uint8Array(),true);break;}
      physicalRead+=count;
      // The streaming decoder may retain incomplete compressed blocks across
      // pushes; never hand it a view of the reusable input buffer.
      if(decoder)decoder.push(Buffer.from(buffer.subarray(0,count)));else accept(buffer.subarray(0,count));
    }
  }catch(error){
    if(error!==stop){if(compressed&&typeof error.code==='number')throw Error('压缩历史解压失败，文件可能损坏');throw error;}
  }finally{fs.closeSync(fd);}
  if(end!=null&&position<end)throw Error('历史大小或分支边界无法安全读取');
  return {size:end??position,physicalRead};
}
