import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

export function compileWindowsInstaller({output,icon,archive,checksum,version}){
  const repo=fileURLToPath(new URL('../',import.meta.url));
  version??=JSON.parse(fs.readFileSync(path.join(repo,'package.json'),'utf8')).version;
  if(!/^\d+\.\d+\.\d+$/.test(version))throw Error('Invalid installer product version');
  const compiler=path.join(process.env.SystemRoot,'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  const args=['/nologo','/optimize+','/target:winexe','/platform:anycpu',...(icon?['/win32icon:'+icon]:[]),
    ...['System.Windows.Forms.dll','System.Drawing.dll','System.IO.Compression.dll'].map(name=>'/reference:'+name),
    '/out:'+output];
  if(archive){
    if(!checksum)throw Error('Embedded installer archive requires a checksum');
    args.push('/resource:'+archive+',ContextManager.Payload.zip','/resource:'+checksum+',ContextManager.Payload.sha256');
  }
  args.push(path.join(repo,'windows/native/Installer.cs'));
  const metadataDirectory=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-installer-version-')),metadata=path.join(metadataDirectory,'Version.cs');
  try{
    fs.writeFileSync(metadata,`[assembly:System.Reflection.AssemblyTitle("Context Manager Setup")]\n[assembly:System.Reflection.AssemblyProduct("Context Manager")]\n[assembly:System.Reflection.AssemblyVersion("${version}.0")]\n[assembly:System.Reflection.AssemblyFileVersion("${version}.0")]\n[assembly:System.Reflection.AssemblyInformationalVersion("${version}")]\n`);
    args.push(metadata);const result=spawnSync(compiler,args,{encoding:'utf8',windowsHide:true,timeout:120000});
    if(result.error||result.status!==0)throw Error(result.error?.message||result.stdout+result.stderr);
  }finally{fs.rmSync(metadata,{force:true});fs.rmdirSync(metadataDirectory);}
}
