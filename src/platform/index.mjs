import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {powershell,windowsProcessInfo,desktopInstallation as windowsDesktopInstallation} from './windows-system.mjs';
import {posixProcessInfo} from './posix-system.mjs';
export {powershell} from './windows-system.mjs';

export const windows=process.platform==='win32';
export function defaultRoot({platform=process.platform,home=os.homedir(),env=process.env}={}){
  return platform==='win32'?path.win32.join(env.LOCALAPPDATA||path.win32.join(home,'AppData','Local'),'CodexContextControl'):path.join(home,'Library/Application Support/CodexContextControl');
}
export function ipcEndpoint(directory,{platform=process.platform,home=os.homedir()}={}){
  if(platform!=='win32')return path.join(directory,'ipc.sock');
  const id=crypto.createHash('sha256').update(home.toLowerCase()+'\0'+path.win32.resolve(directory).toLowerCase()).digest('hex').slice(0,32);
  return '\\\\.\\pipe\\codex-context-'+id;
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
export function processInfo(pid){return windows?windowsProcessInfo(pid):posixProcessInfo(pid);}
export function desktopInstallation(){return windows?windowsDesktopInstallation():null;}
