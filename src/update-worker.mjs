import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {root,readJSON,atomicJSON} from './paths.mjs';
const execute=promisify(execFile);
export function expectedChecksum(text,filename){const match=text.trim().match(/^([a-f0-9]{64})\s+\*?([^\r\n]+)$/i);if(!match||match[2]!==filename)throw Error('更新校验文件无效');return match[1].toLowerCase();}
export async function downloadVerified(update,directory,{fetcher=fetch}={}){
 const prefix='https://github.com/Fandy-ust/codex-context-control/releases/download/';
 if(!update.url?.startsWith(prefix)||!update.checksumURL?.startsWith(prefix)||path.basename(update.filename)!==update.filename)throw Error('更新来源无效');
 const options={signal:AbortSignal.timeout(180000)};
 const checksum=await fetcher(update.checksumURL,options);if(!checksum.ok)throw Error('无法下载更新校验文件');
 const expected=expectedChecksum(await checksum.text(),update.filename);
 if(update.sha256&&update.sha256!==expected)throw Error('版本文件与下载校验值不一致');
 const response=await fetcher(update.url,options);if(!response.ok||!response.body)throw Error('无法下载更新');
 const target=path.join(directory,update.filename),stage=target+'.partial';let bytes=0;const hash=crypto.createHash('sha256');
 const handle=await fsp.open(stage,'w',0o600);
 try{
  for await(const chunk of response.body){bytes+=chunk.length;if(bytes>update.size||bytes>256*1024*1024)throw Error('更新文件大小异常');hash.update(chunk);await handle.writeFile(chunk);}
  if(bytes!==update.size||hash.digest('hex')!==expected)throw Error('更新文件校验失败');
 }catch(error){await handle.close();await fsp.rm(stage,{force:true});throw error;}
 await handle.close();await fsp.rename(stage,target);return target;
}
export async function detachUpdateMount(mount,{run=execute,pause=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 for(let attempt=0;attempt<3;attempt++){
  try{await run('/usr/bin/hdiutil',['detach',mount],{timeout:10000});return true;}catch{if(attempt<2)await pause(1500);}
 }
 return false;
}
async function main(){
 const stateFile=path.join(root,'updates.json');let mount,folder;
 const set=change=>atomicJSON(stateFile,{...readJSON(stateFile,{}),...change});
 try{
  const update=readJSON(stateFile)?.update;if(!update)throw Error('没有可安装的更新');
  folder=await fsp.mkdtemp(path.join(root,'update-'));const image=await downloadVerified(update,folder);
  mount=path.join(folder,'volume');await fsp.mkdir(mount);
  await execute('/usr/bin/hdiutil',['attach','-readonly','-nobrowse','-mountpoint',mount,image],{timeout:60000});
  const installer=path.join(mount,'Install Context Manager.app');
  await execute('/usr/bin/codesign',['--verify','--strict','--deep',installer],{timeout:30000});
  const metadata=readJSON(path.join(installer,'Contents/Resources/payload-manifest.json'));
  if(metadata?.version!==update.version||metadata?.arch!=='arm64')throw Error('更新包版本不匹配');
  set({phase:'installing'});
  // The native installer verifies every payload hash before replacing the app.
  await execute(path.join(installer,'Contents/MacOS/Installer'),['--install-update'],{timeout:180000});
  set({phase:'installed',error:null});
 }catch(error){set({phase:'error',error:error.message,pid:null});process.exitCode=1;}
 finally{
  const detached=!mount||await detachUpdateMount(mount);
  if(folder&&detached){try{await fsp.rm(folder,{recursive:true,force:true});set({pid:null,cleanupPending:null});}catch{set({pid:null,cleanupPending:folder});}}
  else set({pid:null,cleanupPending:folder??null});
 }
}
if(process.argv[1]===fileURLToPath(import.meta.url))main();
