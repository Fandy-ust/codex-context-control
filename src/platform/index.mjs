import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';

export const windows=process.platform==='win32';
export function defaultRoot({platform=process.platform,home=os.homedir(),env=process.env}={}){
  return platform==='win32'?path.win32.join(env.LOCALAPPDATA||path.win32.join(home,'AppData','Local'),'CodexContextControl'):path.join(home,'Library/Application Support/CodexContextControl');
}
export function ipcEndpoint(directory,{platform=process.platform,home=os.homedir()}={}){
  if(platform!=='win32')return path.join(directory,'ipc.sock');
  const id=crypto.createHash('sha256').update(home.toLowerCase()+'\0'+path.win32.resolve(directory).toLowerCase()).digest('hex').slice(0,32);
  return '\\\\.\\pipe\\codex-context-'+id;
}
export function powershell(script,env={}, {timeout=15000}={}){
  const exe=path.join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
  const result=spawnSync(exe,['-NoLogo','-NoProfile','-NonInteractive','-OutputFormat','Text','-EncodedCommand',Buffer.from('$ErrorActionPreference="Stop";$ProgressPreference="SilentlyContinue";[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);'+script,'utf16le').toString('base64')],{encoding:'utf8',timeout,windowsHide:true,env:{...process.env,...env},maxBuffer:8*1024*1024});
  if(result.error||result.status!==0)throw Error(result.error?.message||result.stderr?.trim()||'Windows system operation failed');
  return result.stdout.trim();
}
const secured=new Set();
export function privateDirectory(directory){
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  if(!windows||secured.has(directory))return;
  // A fresh protected DACL, rather than Unix mode bits (which Windows ignores).
  powershell('$p=$env:CONTEXT_CONTROL_ACL_PATH;$acl=New-Object System.Security.AccessControl.DirectorySecurity;$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User;$acl.SetAccessRuleProtection($true,$false);foreach($s in @($sid,[System.Security.Principal.SecurityIdentifier]::new("S-1-5-18"))){$rule=[System.Security.AccessControl.FileSystemAccessRule]::new($s,"FullControl","ContainerInherit,ObjectInherit","None","Allow");$acl.AddAccessRule($rule)};[System.IO.Directory]::SetAccessControl($p,$acl)',{CONTEXT_CONTROL_ACL_PATH:path.resolve(directory)});
  secured.add(directory);
}
export function prepareEndpoint(endpoint){if(!windows)try{fs.unlinkSync(endpoint);}catch(e){if(e.code!=='ENOENT')throw e;}}
export function secureEndpoint(endpoint){if(!windows)fs.chmodSync(endpoint,0o600);}
export function processInfo(pid){
  if(!Number.isSafeInteger(pid)||pid<1)return null;
  if(windows){try{const raw=powershell('$p=Get-CimInstance Win32_Process -Filter ("ProcessId="+$env:CONTEXT_CONTROL_QUERY_PID);if($p){@{pid=$p.ProcessId;parent=$p.ParentProcessId;executable=$p.ExecutablePath;command=$p.CommandLine}|ConvertTo-Json -Compress}',{CONTEXT_CONTROL_QUERY_PID:String(pid)});return raw?JSON.parse(raw):null;}catch{return null;}}
  const r=spawnSync('/bin/ps',['-p',String(pid),'-o','ppid=,comm=,args='],{encoding:'utf8',timeout:2000});
  const m=r.stdout?.trim().match(/^(\d+)\s+(\S+)\s+(.+)$/);return m?{pid,parent:Number(m[1]),executable:m[2],command:m[3]}:null;
}
export function desktopInstallation(){
  if(!windows)return null;
  try{
    const location=powershell('$p=Get-AppxPackage -Name OpenAI.Codex|Sort-Object Version -Descending|Select-Object -First 1;if($p){$p.InstallLocation}');
    if(location){const executable=path.join(location,'app/ChatGPT.exe'),binary=path.join(location,'app/resources/codex.exe');if(fs.existsSync(executable)&&fs.existsSync(binary))return {executable,binary};}
  }catch{}
  for(const directory of ['Programs/OpenAI/Codex','Programs/OpenAI/ChatGPT','Programs/Codex','Programs/ChatGPT'].map(p=>path.join(process.env.LOCALAPPDATA||'',p))){
    for(const name of ['ChatGPT','Codex']){
      const executable=path.join(directory,`${name}.exe`),binary=path.join(directory,'resources/codex.exe');
      if(fs.existsSync(executable)&&fs.existsSync(binary))return {executable,binary};
    }
  }
  return null;
}
