import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {atomicJSON,readJSON,root} from './paths.mjs';
import {repository,releaseManifestURL,releaseMatrixURL,releaseAPI,manifestCandidate,updateSourceError} from './update-source.mjs';
export {releaseAPI,releaseManifestURL,releaseMatrixURL};
import {newerVersion,releaseUpdate,artifactForTarget} from './core/update-artifact.mjs';
export {newerVersion,releaseUpdate} from './core/update-artifact.mjs';
export function createUpdateManager({home=root,cacheFile=path.join(home,'updates.json'),current,fetcher=fetch,launch,node=process.env.CONTEXT_CONTROL_NODE||process.execPath,now=Date.now,platform=process.platform,arch=process.arch}={}){
 const file=cacheFile;let checking;const target={platform,arch};
 const read=()=>{try{return readJSON(file,{})??{};}catch{return {};}};
 function status(){const s=read();return {currentVersion:current,available:artifactForTarget(s.update,target)&&newerVersion(s.update.version,current),version:s.update?.version??null,phase:s.phase??'idle',checkedAt:s.checkedAt??null,error:s.error??null,retryAt:s.retryAt??null,source:s.source??null};}
 async function check(force=false){
  if(!force&&readJSON(path.join(home,'ui-settings.json'),{}).autoCheckUpdates===false)return status();
  if(checking){await checking;return status();}const old=read();
  if(['downloading','installing'].includes(old.phase)){try{process.kill(old.pid,0);return status();}catch{atomicJSON(file,{...old,phase:'error',pid:null,error:'上次更新已中断，请重试'});old.phase='error';}}
  const time=now();
  if(old.checkedVersion===current){
   if(time<(old.retryAt??0))return status();
   if(!force&&!old.error&&old.checkedAt&&time-old.checkedAt<6*60*60*1000)return status();
  }
  checking=(async()=>{
   const cooldowns={...(old.sourceCooldowns??{})},failures=[];
   for(const [source,url] of [['release-file',platform==='win32'?releaseMatrixURL:releaseManifestURL],['github-api',releaseAPI]]){
    if(now()<(cooldowns[source]??0))continue;
    try{
     const response=await fetcher(url,{headers:{Accept:'application/json','User-Agent':'Context-Manager','Cache-Control':'no-cache'},signal:AbortSignal.timeout(10000)});
     if(!response.ok)throw await updateSourceError(response,source,now());
     let update;
     try{const document=await response.json();if(source==='release-file'){const candidate=manifestCandidate(document,target);if(candidate===null)continue;update=candidate&&newerVersion(candidate.version,current)?candidate:null;}else update=releaseUpdate(document,current,{platform,arch});}
     catch{throw Object.assign(Error('更新来源返回了无效版本信息，可从发布页下载。'),{retryAt:now()+60000,code:'invalid_metadata',source});}
     delete cooldowns[source];
     atomicJSON(file,{...old,checkedVersion:current,checkedAt:now(),update,phase:'idle',error:null,errorCode:null,retryAt:null,source,sourceCooldowns:cooldowns});return;
    }catch(error){
     const failure=error.retryAt?error:Object.assign(Error('无法连接更新来源，请稍后重试或从发布页下载。'),{retryAt:now()+60000,code:'unavailable',source});
     cooldowns[source]=failure.retryAt;failures.push(failure);
    }
   }
   const failure=failures.find(e=>e.code==='rate_limited')??failures.at(-1);
   const retryAt=Math.min(...Object.values(cooldowns).filter(t=>t>now()));
   atomicJSON(file,{...old,checkedVersion:current,checkedAt:now(),phase:'idle',error:failure?.message??old.error??'更新来源暂不可用',errorCode:failure?.code??old.errorCode,sourceCooldowns:cooldowns,retryAt:Number.isFinite(retryAt)?retryAt:now()+60000});
  })().finally(()=>{checking=null;});await checking;return status();
 }

 async function install(){
  if(checking)await checking;
  let s=read();
  if(['downloading','installing'].includes(s.phase)){try{process.kill(s.pid,0);return status();}catch{}}
  // A previously offered release can be stale. Refresh immediately before
  // installation; a failed refresh must not silently install the cached build.
  await check(true);s=read();
  if(['downloading','installing'].includes(s.phase)){try{process.kill(s.pid,0);return status();}catch{}}
  if(s.error)throw Error(s.error);
  if(!artifactForTarget(s.update,target)||!newerVersion(s.update.version,current))throw Error('没有可安装的更新');
  // This path is called only by the explicit Install update button.
  atomicJSON(file,{...s,phase:'downloading',error:null,pid:process.pid});
  let child;
  try{
    child=(launch??(()=>spawn(node,[fileURLToPath(new URL(platform==='win32'?'./windows-update-worker.mjs':'./update-worker.mjs',import.meta.url))],{detached:true,windowsHide:true,stdio:'ignore',env:{...process.env,CONTEXT_CONTROL_HOME:home,CONTEXT_CONTROL_UPDATE_STATE:file}})))();
    child.once?.('error',error=>atomicJSON(file,{...read(),phase:'error',error:error.message,pid:null}));
    if(!Number.isSafeInteger(child.pid))throw Error('无法启动更新程序');
  }catch(error){atomicJSON(file,{...read(),phase:'error',error:error.message,pid:null});throw error;}
  atomicJSON(file,{...read(),pid:child.pid});child.unref?.();return status();
 }
 return {status,check,install};
}
