import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
export function powershell(script,env={}, {timeout=15000}={}){
  const exe=path.join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
  const result=spawnSync(exe,['-NoLogo','-NoProfile','-NonInteractive','-OutputFormat','Text','-EncodedCommand',Buffer.from('$ErrorActionPreference="Stop";$ProgressPreference="SilentlyContinue";[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);'+script,'utf16le').toString('base64')],{encoding:'utf8',timeout,windowsHide:true,env:{...process.env,...env},maxBuffer:8*1024*1024});
  if(result.error||result.status!==0)throw Error(result.error?.message||result.stderr?.trim()||'Windows system operation failed');
  return result.stdout.trim();
}
export function desktopInstallation(){
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

export function windowsProcessInfo(pid){
 if(!Number.isSafeInteger(pid)||pid<1)return null;
 try{const raw=powershell('$p=Get-CimInstance Win32_Process -Filter ("ProcessId="+$env:CONTEXT_CONTROL_QUERY_PID);if($p){@{pid=$p.ProcessId;parent=$p.ParentProcessId;executable=$p.ExecutablePath;command=$p.CommandLine}|ConvertTo-Json -Compress}',{CONTEXT_CONTROL_QUERY_PID:String(pid)});return raw?JSON.parse(raw):null;}catch{return null;}
}
export function windowsProcesses(){
 try{const raw=powershell('$items=@(Get-CimInstance Win32_Process|Select-Object ProcessId,ExecutablePath,CommandLine);ConvertTo-Json -InputObject $items -Compress');return JSON.parse(raw).map(p=>({pid:p.ProcessId,executable:p.ExecutablePath,command:p.CommandLine}));}catch{return null;}
}
