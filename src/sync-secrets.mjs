import {spawnSync} from 'node:child_process';
import path from 'node:path';
import crypto from 'node:crypto';
import {readJSON,atomicJSON} from './paths.mjs';

// Secrets never appear in process arguments, UI state, sync data or diagnostics.
export function syncSecrets(home){
  const file=path.join(home,'cloud-sync-secrets.json');
  const account=crypto.createHash('sha256').update(path.resolve(home)).digest('hex');
  function run(command,args,input){
    const r=spawnSync(command,args,{input,encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:65536});
    if(r.error||r.status!==0)throw Error('系统凭据存储不可用');return r.stdout.trim();
  }
  function protect(input,decode=false){
    return run('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Add-Type -AssemblyName System.Security; $v=[Console]::In.ReadToEnd(); ${decode?"[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($v),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))":"[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($v),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))"}`],input);
  }
  return {
    get(){
      if(process.platform==='win32'){const saved=readJSON(file);return saved?JSON.parse(protect(saved.data,true)):{};}
      if(process.platform==='darwin'){
        const r=spawnSync('/usr/bin/security',['find-generic-password','-s','io.github.context-manager.cloud-sync','-a',account,'-w'],{encoding:'utf8',timeout:15000});
        if(r.status===44)return {};if(r.status!==0)throw Error('系统凭据存储不可用');return JSON.parse(Buffer.from(r.stdout.trim(),'base64').toString());
      }
      throw Error('Cloud sync credentials require Windows or macOS');
    },
    set(value){
      const json=JSON.stringify(value);
      if(process.platform==='win32')atomicJSON(file,{version:1,data:protect(json)});
      else if(process.platform==='darwin')run('/usr/bin/security',['-i'],`add-generic-password -U -s io.github.context-manager.cloud-sync -a ${account} -w ${Buffer.from(json).toString('base64')}\n`);
      else throw Error('Cloud sync credentials require Windows or macOS');
    }
  };
}
