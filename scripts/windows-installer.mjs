import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

export function compileWindowsInstaller({output,icon,archive,checksum}){
  const repo=fileURLToPath(new URL('../',import.meta.url));
  const compiler=path.join(process.env.SystemRoot,'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  const args=['/nologo','/optimize+','/target:winexe','/platform:anycpu',...(icon?['/win32icon:'+icon]:[]),
    ...['System.Windows.Forms.dll','System.Drawing.dll','System.IO.Compression.dll'].map(name=>'/reference:'+name),
    '/out:'+output];
  if(archive){
    if(!checksum)throw Error('Embedded installer archive requires a checksum');
    args.push('/resource:'+archive+',ContextManager.Payload.zip','/resource:'+checksum+',ContextManager.Payload.sha256');
  }
  args.push(path.join(repo,'windows/native/Installer.cs'));
  const result=spawnSync(compiler,args,{encoding:'utf8',windowsHide:true,timeout:120000});
  if(result.error||result.status!==0)throw Error(result.error?.message||result.stdout+result.stderr);
}
