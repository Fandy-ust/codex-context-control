import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {probeAppServer} from './runtime-probe.mjs';
import {runtimeSupported} from './compatibility.mjs';

const revision=1;
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function fileIdentity(file){
  try{const real=fs.realpathSync(file),s=fs.statSync(real);return [real,s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs];}catch{return [file,'missing'];}
}
function identity(binary,managerVersion,extraArgs){
  // macOS distributions may use a stable shell launcher around a replaced CLI.
  return digest([revision,process.platform,process.arch,managerVersion,fileIdentity(binary),fileIdentity(path.join(path.dirname(binary),'../CodexCLI.app/Contents/MacOS/codex')),extraArgs]);
}
export function readRuntimeCompatibility(home){
  try{return JSON.parse(fs.readFileSync(path.join(home,'runtime-compatibility.json'),'utf8'));}catch{return null;}
}
function save(home,value){
  let temporary;
  try{
    fs.mkdirSync(home,{recursive:true});temporary=path.join(home,`.runtime-compatibility-${process.pid}-${crypto.randomBytes(4).toString('hex')}.tmp`);
    fs.writeFileSync(temporary,JSON.stringify(value)+'\n',{flag:'wx',mode:0o600});fs.renameSync(temporary,path.join(home,'runtime-compatibility.json'));
  }catch{/* A diagnostic cache must never prevent native startup. */}
  finally{if(temporary)try{fs.unlinkSync(temporary);}catch{}}
}
export function recordRuntimeStartupFailure(home,result){
  if(!result?.identity)return;
  // A failed older process must not invalidate evidence for a newer runtime.
  if(readRuntimeCompatibility(home)?.identity!==result.identity)return;
  save(home,{...result,enhanced:false,reason:'native-startup-failed',checkedAt:Date.now(),cached:false});
}

export async function checkRuntimeCompatibility({binary,home,managerVersion,extraArgs=[],probe=probeAppServer,versionOf,now=Date.now,successTtl=86400000,failureTtl=60000}){
  const key=identity(binary,managerVersion,extraArgs),previous=readRuntimeCompatibility(home),at=now();
  const age=at-(previous?.checkedAt??0);
  if(previous?.identity===key&&typeof previous.enhanced==='boolean'&&age>=0&&age<(previous.enhanced?successTtl:failureTtl))return {...previous,cached:true};
  let temp,nativeVersion;
  const result={identity:key,managerVersion,platform:process.platform,arch:process.arch,enhanced:false,reason:'probe-failed',checkedAt:at,cached:false};
  try{
    if(versionOf)nativeVersion=versionOf(binary);
    else{
      const version=spawnSync(binary,['--version'],{windowsHide:true,encoding:'utf8',timeout:1500});
      nativeVersion=version.status===0?version.stdout:'';
    }
    if(!runtimeSupported(nativeVersion)){result.reason='unrecognized-runtime';return result;}
    result.runtimeVersion=nativeVersion.trim();
    temp=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-runtime-check-'));
    fs.writeFileSync(path.join(temp,'config.toml'),'[features]\nplugins=false\n[analytics]\nenabled=false\n[feedback]\nenabled=false\n');
    const response=await probe({command:binary,args:['app-server','--listen','stdio://',...extraArgs],cwd:temp,env:{...process.env,CODEX_HOME:temp,CONTEXT_CONTROL_CODEX_HOME:temp}});
    // Check manager-owned overrides, not user settings. Unknown config keys can
    // otherwise be silently ignored by a newer CLI while initialize succeeds.
    for(let i=0;i<extraArgs.length;i+=2){
      const assignment=extraArgs[i+1],equal=assignment.indexOf('='),name=assignment.slice(0,equal);
      const expected=JSON.parse(assignment.slice(equal+1));
      if(extraArgs[i]!=='-c'||response.config[name]!==expected){result.reason='config-override-not-confirmed';return result;}
    }
    if(identity(binary,managerVersion,extraArgs)!==key){result.reason='runtime-changed-during-probe';return result;}
    result.enhanced=true;result.reason='verified';return result;
  }catch(error){result.reason=/^probe-[a-z-]+$/.test(error.code||'')?error.code:'probe-failed';return result;}
  finally{
    save(home,result);
    if(temp)try{fs.rmSync(temp,{recursive:true,force:true,maxRetries:2,retryDelay:50});}catch{}
  }
}
