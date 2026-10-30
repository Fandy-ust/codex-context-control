import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Rename prevents torn readers; fsync also commits the new contents before rename.
export function durableWrite(file, bytes) {
 fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
 const tmp=file+'.'+process.pid+'.'+crypto.randomBytes(8).toString('hex')+'.tmp';
 let fd;
 try {fd=fs.openSync(tmp,'wx',0o600);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(tmp,file);
  // Windows does not support opening directories this way. File flush above is mandatory.
  if(process.platform!=='win32'){const dir=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}}
 } finally {if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(tmp);}catch{}}
}
const parse=bytes=>JSON.parse(bytes.toString('utf8'));
function valid(file){try{const bytes=fs.readFileSync(file);parse(bytes);return bytes;}catch{return null;}}
export function writeProtectedJSON(file,value){
 const next=Buffer.from(JSON.stringify(value,null,2)+'\n');parse(next);
 const before=valid(file),first=valid(file+'.safe-1');
 if(before&&!before.equals(next)){
  if(first&&!first.equals(before))durableWrite(file+'.safe-2',first);
  durableWrite(file+'.safe-1',before);
 }
 durableWrite(file,next);
 if(!valid(file+'.safe-1'))durableWrite(file+'.safe-1',next);
 if(!valid(file+'.safe-2'))durableWrite(file+'.safe-2',next);
}
export function readProtectedJSON(file,fallback=null){
 try{return parse(fs.readFileSync(file));}catch(error){
  for(const suffix of ['.safe-1','.safe-2']){const bytes=valid(file+suffix);if(!bytes)continue;
   if(fs.existsSync(file))durableWrite(file+'.damaged',fs.readFileSync(file));
   durableWrite(file,bytes);return parse(bytes);
  }
  if(error.code==='ENOENT')return fallback;
  throw error;
 }
}
