import fs from 'node:fs';
import path from 'node:path';
import {powershell} from './index.mjs';
import {root,readJSON,atomicJSON,ensureRoot} from '../paths.mjs';

export function userEnvironment(key='CODEX_CLI_PATH'){
  return powershell('[Environment]::GetEnvironmentVariable($env:CONTEXT_CONTROL_ENV_KEY,"User")',{CONTEXT_CONTROL_ENV_KEY:key});
}
function setEnvironment(key,value){
  powershell('[Environment]::SetEnvironmentVariable($env:CONTEXT_CONTROL_ENV_KEY,$env:CONTEXT_CONTROL_ENV_VALUE,"User");Add-Type -TypeDefinition \'using System;using System.Runtime.InteropServices;public class ContextControlBroadcast{[DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)]public static extern IntPtr SendMessageTimeout(IntPtr h,uint m,UIntPtr w,string l,uint f,uint t,out UIntPtr r);}\';$r=[UIntPtr]::Zero;[void][ContextControlBroadcast]::SendMessageTimeout([IntPtr]65535,26,[UIntPtr]::Zero,"Environment",2,2000,[ref]$r)',{CONTEXT_CONTROL_ENV_KEY:key,CONTEXT_CONTROL_ENV_VALUE:value||''});
}
const file=options=>options.recordFile||path.join(root,'automatic-startup.json');
export function windowsStartupStatus(options={}){
  const record=readJSON(file(options));if(!record)return {installed:false,environmentActive:false,loginJobLoaded:false};
  const active=userEnvironment(record.key)===record.value;
  return {installed:fs.existsSync(record.value),environmentActive:active,loginJobLoaded:active,pendingProcessRestart:process.env[record.key]!==record.value,mechanism:'user-environment'};
}
export function enableWindowsStartup(shim,options={}){
  ensureRoot();if(!path.isAbsolute(shim)||!fs.existsSync(shim)||path.extname(shim).toLowerCase()!=='.exe')throw Error('Windows automatic integration requires an existing .exe launcher');
  const key=options.key||'CODEX_CLI_PATH',previous=readJSON(file(options)),before=userEnvironment(key);
  if(before&&before!==shim&&before!==previous?.value)throw Error(`${key} 已有其他自定义设置；已保留原值，未启用自动接入。`);
  const record={version:1,platform:'win32',key,value:shim,previousValue:previous?.previousValue??(before===shim?'':before)};
  try{setEnvironment(key,shim);if(userEnvironment(key)!==shim)throw Error('自动接入环境未读回确认');atomicJSON(file(options),record);}catch(error){if(userEnvironment(key)===shim)setEnvironment(key,before);throw error;}
  return windowsStartupStatus(options);
}
export function disableWindowsStartup(options={}){
  const record=readJSON(file(options));if(!record)return {removed:false};
  if(userEnvironment(record.key)===record.value)setEnvironment(record.key,record.previousValue);
  fs.rmSync(file(options),{force:true});return {removed:true};
}
