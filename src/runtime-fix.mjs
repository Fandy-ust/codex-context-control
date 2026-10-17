import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {root,atomicJSON,readJSON,realBinary} from './paths.mjs';
import {runtimeHelpersFingerprint,validateRuntimeHelpers} from './runtime-helpers.mjs';

export const runtimeFixPin=JSON.parse(fs.readFileSync(new URL('../runtime-patches/manifest.json',import.meta.url),'utf8'));
const fingerprint=file=>{try{const s=fs.statSync(file);return `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`;}catch{return 'missing';}};
export function fileSHA256(file){
  const hash=crypto.createHash('sha256'),buffer=Buffer.alloc(1024*1024),fd=fs.openSync(file,'r');
  try{let n;while((n=fs.readSync(fd,buffer,0,buffer.length,null)))hash.update(buffer.subarray(0,n));}finally{fs.closeSync(fd);}
  return hash.digest('hex');
}
export function validateRuntimePackage(directory,{platform=process.platform,arch=process.arch}={}){
  const manifest=readJSON(path.join(directory,'runtime.json'));
  const pin=runtimeFixPin;
  if(!manifest||manifest.id!==pin.id||manifest.baseVersion!==pin.baseVersion||manifest.sourceCommit!==pin.sourceCommit||manifest.patchSHA256!==pin.patchSHA256||manifest.validated!==true)throw Error('修复包来源或验证记录不匹配');
  if(manifest.platform!==platform||manifest.arch!==arch)throw Error('修复包与这台电脑不兼容');
  if(!['codex','bin/codex'].includes(manifest.entrypoint??'codex'))throw Error('运行时入口无效');
  const binary=path.join(directory,manifest.entrypoint??'codex'),stat=fs.lstatSync(binary);
  if(!stat.isFile()||stat.isSymbolicLink()||!(stat.mode&0o111))throw Error('修复版运行时文件无效');
  if(!/^[a-f0-9]{64}$/.test(manifest.binarySHA256)||fileSHA256(binary)!==manifest.binarySHA256)throw Error('修复版运行时校验失败');
  return {manifest,binary};
}

export function createRuntimeFixManager({home=root,platform=process.platform,arch=process.arch,versionOf,versionRetryMs=10000,allowPatchedRuntime=false}={}){
  const versionCache=new Map();
  const version=file=>{
    if(!file)return null;
    if(versionOf)return versionOf(file);
    // Desktop distributions use a stable shell launcher next to a nested app.
    const companion=path.join(path.dirname(file),'../CodexCLI.app/Contents/MacOS/codex');
    const key=fingerprint(file)+':'+fingerprint(companion),previous=versionCache.get(file);
    if(previous?.key===key&&(previous.value!=null||Date.now()-previous.at<versionRetryMs))return previous.value;
    const r=spawnSync(file,['--version'],{encoding:'utf8',timeout:5000});
    const value=r.status===0?r.stdout.trim().match(/^codex-cli (\d+\.\d+\.\d+(?:[-+][\w.-]+)?)$/)?.[1]??null:null;
    versionCache.set(file,{key,value,at:Date.now()});return value;
  };
  const file=path.join(home,'runtime-fix.json'),directory=path.join(home,'runtimes',runtimeFixPin.id);
  let cachedPackage;
  function packageStatus(){
    const key=fingerprint(path.join(directory,'runtime.json'))+':'+fingerprint(path.join(directory,'codex'))+':'+fingerprint(path.join(directory,'bin/codex'))+':'+runtimeHelpersFingerprint(directory);
    if(cachedPackage?.key===key&&(!cachedPackage.retryAt||Date.now()<cachedPackage.retryAt))return cachedPackage;
    try{const result=validateRuntimePackage(directory,{platform,arch});
      if(result.manifest.entrypoint!=='bin/codex')throw Error('修复包尚未完成桌面安装');
      validateRuntimeHelpers(directory,runtimeFixPin.baseVersion);
      const installedVersion=version(result.binary);
      if(installedVersion==null)throw Object.assign(Error('修复版版本检查暂时失败，请稍后重试'),{transient:true});
      if(installedVersion!==runtimeFixPin.baseVersion)throw Error('修复版运行时版本不符');
      cachedPackage={key,available:true,...result};
    }catch(error){cachedPackage={key,available:false,...(error.transient?{retryAt:Date.now()+versionRetryMs}:{}),message:key.includes('missing')?'修复包尚未安装':error.message};}
    return cachedPackage;
  }
  function status(original,bridges=[]){
    if(!original){try{original=realBinary();}catch{original=null;}}
    if(!allowPatchedRuntime){
      const activeCount=bridges.filter(b=>b.runtimeFixId===runtimeFixPin.id).length;
      return {enabled:false,available:false,compatible:false,baseVersion:runtimeFixPin.baseVersion,originalVersion:version(original),activeCount,pending:activeCount>0,message:activeCount?'已关闭，退出并重开 Codex 后恢复原版':'已关闭'};
    }
    let enabled=false;try{enabled=readJSON(file,{})?.enabled===true;}catch{}
    const pack=packageStatus(),originalVersion=version(original);
    const compatible=platform==='darwin'&&arch==='arm64'&&originalVersion===runtimeFixPin.baseVersion;
    const activeCount=bridges.filter(b=>b.runtimeFixId===runtimeFixPin.id).length;
    const pending=enabled?activeCount<bridges.length||bridges.length===0:activeCount>0;
    let message=!pack.available?pack.message:!compatible?'Codex 版本不匹配，后续启动使用原版':!enabled?'已关闭':pending?'已开启，退出并重开 Codex 后生效':'已生效';
    if(!enabled&&activeCount>0)message='已关闭，退出并重开 Codex 后恢复原版';
    return {enabled,available:pack.available,compatible,baseVersion:runtimeFixPin.baseVersion,originalVersion,activeCount,pending,message};
  }
  function setEnabled(enabled,original,bridges=[]){
    if(typeof enabled!=='boolean')throw Error('开关值无效');
    const current=status(original,bridges);
    if(enabled&&(!current.available||!current.compatible))throw Error(current.message);
    atomicJSON(file,{enabled,patchId:runtimeFixPin.id,updatedAt:Date.now()});
    return status(original,bridges);
  }
  function select(original){
    const s=status(original);
    if(s.enabled&&s.available&&s.compatible)return {binary:packageStatus().binary,runtimeFixId:runtimeFixPin.id,originalVersion:s.originalVersion};
    return {binary:original,runtimeFixId:null,originalVersion:s.originalVersion};
  }
  return {status,setEnabled,select};
}
