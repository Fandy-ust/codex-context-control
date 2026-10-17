import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {atomicJSON,readJSON,root} from './paths.mjs';
export const releaseAPI='https://api.github.com/repos/Fandy-ust/codex-context-control/releases/latest';
const repository='https://github.com/Fandy-ust/codex-context-control/';
export function newerVersion(candidate,current){
 if(!/^\d+\.\d+\.\d+$/.test(candidate)||!/^\d+\.\d+\.\d+$/.test(current))return false;
 const a=candidate.split('.').map(Number),b=current.split('.').map(Number);
 for(let i=0;i<3;i++){if(a[i]!==b[i])return a[i]>b[i];}return false;
}
export function releaseUpdate(release,current){
 if(release.draft||release.prerelease)return null;
 const version=release.tag_name?.match(/^v(\d+\.\d+\.\d+)(?:-preview\.\d+)?$/)?.[1];
 if(!version||!newerVersion(version,current))return null;
 const filename=`Context-Manager-${version}-macos-arm64.dmg`;
 const asset=name=>release.assets?.find(a=>a.name===name&&a.state==='uploaded');
 const image=asset(filename),checksum=asset(filename+'.sha256');
 const prefix=repository+'releases/download/'+release.tag_name+'/';
 if(!image||!checksum||image.browser_download_url!==prefix+filename||checksum.browser_download_url!==prefix+filename+'.sha256'||!Number.isSafeInteger(image.size)||image.size<=0||image.size>256*1024*1024)throw Error('更新文件信息无效');
 return {version,filename,url:image.browser_download_url,checksumURL:checksum.browser_download_url,size:image.size,releaseURL:repository+'releases/tag/'+release.tag_name};
}
export function createUpdateManager({home=root,current,fetcher=fetch,launch}={}){
 const file=path.join(home,'updates.json');let checking;
 const read=()=>{try{return readJSON(file,{})??{};}catch{return {};}};
 function status(){const s=read();return {currentVersion:current,available:!!s.update&&newerVersion(s.update.version,current),version:s.update?.version??null,phase:s.phase??'idle',checkedAt:s.checkedAt??null,error:s.error??null};}
 async function check(force=false){
  if(checking)return checking;const old=read();
  if(['downloading','installing'].includes(old.phase)){try{process.kill(old.pid,0);return status();}catch{atomicJSON(file,{...old,phase:'error',pid:null,error:'上次更新已中断，请重试'});old.phase='error';}}
  if(!force&&Date.now()-(old.checkedAt??0)<6*60*60*1000)return status();
  checking=(async()=>{try{
   const response=await fetcher(releaseAPI,{headers:{Accept:'application/vnd.github+json','User-Agent':'Context-Manager'},signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw Error('更新检查失败：HTTP '+response.status);
   const update=releaseUpdate(await response.json(),current);
   atomicJSON(file,{checkedAt:Date.now(),update,phase:'idle',error:null});
  }catch(error){atomicJSON(file,{...old,checkedAt:Date.now(),phase:'idle',error:error.message});}return status();})().finally(()=>{checking=null;});return checking;
 }
 async function install(){
  if(checking)await checking;
  const s=read();if(!s.update||!newerVersion(s.update.version,current))throw Error('没有可安装的更新');
  if(['downloading','installing'].includes(s.phase)){try{process.kill(s.pid,0);return status();}catch{}}
  // This path is called only by the explicit Install update button.
  atomicJSON(file,{...s,phase:'downloading',error:null,pid:process.pid});
  let child;
  try{
    child=(launch??(()=>spawn(process.execPath,[fileURLToPath(new URL('./update-worker.mjs',import.meta.url))],{detached:true,stdio:'ignore',env:{...process.env,CONTEXT_CONTROL_HOME:home}})))();
    child.once?.('error',error=>atomicJSON(file,{...read(),phase:'error',error:error.message,pid:null}));
    if(!Number.isSafeInteger(child.pid))throw Error('无法启动更新程序');
  }catch(error){atomicJSON(file,{...read(),phase:'error',error:error.message,pid:null});throw error;}
  atomicJSON(file,{...read(),pid:child.pid});child.unref?.();return status();
 }
 return {status,check,install};
}
