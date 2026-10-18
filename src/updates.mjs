import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {atomicJSON,readJSON,root} from './paths.mjs';
import {repository,releaseManifestURL,releaseAPI,manifestCandidate,updateSourceError} from './update-source.mjs';
export {releaseAPI,releaseManifestURL};
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
export function createUpdateManager({home=root,current,fetcher=fetch,launch,now=Date.now}={}){
 const file=path.join(home,'updates.json');let checking;
 const read=()=>{try{return readJSON(file,{})??{};}catch{return {};}};
 function status(){const s=read();return {currentVersion:current,available:!!s.update&&newerVersion(s.update.version,current),version:s.update?.version??null,phase:s.phase??'idle',checkedAt:s.checkedAt??null,error:s.error??null,retryAt:s.retryAt??null,source:s.source??null};}
 async function check(force=false){
  if(checking){await checking;return status();}const old=read();
  if(['downloading','installing'].includes(old.phase)){try{process.kill(old.pid,0);return status();}catch{atomicJSON(file,{...old,phase:'error',pid:null,error:'上次更新已中断，请重试'});old.phase='error';}}
  const time=now();
  if(time<(old.retryAt??0)||(old.checkedAt&&time-old.checkedAt<30000))return status();
  if(!force&&!old.error&&old.checkedAt&&time-old.checkedAt<6*60*60*1000)return status();
  checking=(async()=>{
   const cooldowns={...(old.sourceCooldowns??{})},failures=[];
   for(const [source,url] of [['release-file',releaseManifestURL],['github-api',releaseAPI]]){
    if(now()<(cooldowns[source]??0))continue;
    try{
     const response=await fetcher(url,{headers:{Accept:'application/json','User-Agent':'Context-Manager'},signal:AbortSignal.timeout(10000)});
     if(!response.ok)throw await updateSourceError(response,source,now());
     let update;
     try{const document=await response.json();if(source==='release-file'){const candidate=manifestCandidate(document);update=newerVersion(candidate.version,current)?candidate:null;}else update=releaseUpdate(document,current);}
     catch{throw Object.assign(Error('更新来源返回了无效版本信息，可从发布页下载。'),{retryAt:now()+60000,code:'invalid_metadata',source});}
     delete cooldowns[source];
     atomicJSON(file,{...old,checkedAt:now(),update,phase:'idle',error:null,errorCode:null,retryAt:null,source,sourceCooldowns:cooldowns});return;
    }catch(error){
     const failure=error.retryAt?error:Object.assign(Error('无法连接更新来源，请稍后重试或从发布页下载。'),{retryAt:now()+60000,code:'unavailable',source});
     cooldowns[source]=failure.retryAt;failures.push(failure);
    }
   }
   const failure=failures.find(e=>e.code==='rate_limited')??failures.at(-1);
   const retryAt=Math.min(...Object.values(cooldowns).filter(t=>t>now()));
   atomicJSON(file,{...old,checkedAt:now(),phase:'idle',error:failure?.message??old.error??'更新来源暂不可用',errorCode:failure?.code??old.errorCode,sourceCooldowns:cooldowns,retryAt:Number.isFinite(retryAt)?retryAt:now()+60000});
  })().finally(()=>{checking=null;});await checking;return status();
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
