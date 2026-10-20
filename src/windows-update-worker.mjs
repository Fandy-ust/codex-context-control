import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {root,readJSON,atomicJSON} from './paths.mjs';
import {powershell} from './platform/index.mjs';
import {verifyWindowsPayload,removeInstallationTree} from './platform/windows-install.mjs';
import {downloadVerified} from './update-worker.mjs';

export async function applyWindowsUpdate(update,{directory,runInstaller,fetcher}={}){
  const folder=directory||fs.mkdtempSync(path.join(root,'update-'));
  try{
    const archive=await downloadVerified(update,folder,{fetcher}),unpacked=path.join(folder,'unpacked');
    powershell('Add-Type -AssemblyName System.IO.Compression.FileSystem;[System.IO.Compression.ZipFile]::ExtractToDirectory($env:CONTEXT_CONTROL_ZIP,$env:CONTEXT_CONTROL_EXTRACT)',{CONTEXT_CONTROL_ZIP:archive,CONTEXT_CONTROL_EXTRACT:unpacked},{timeout:180000});
    const payload=path.join(unpacked,'payload');verifyWindowsPayload(payload,{version:update.version});
    if(runInstaller)await runInstaller(payload);
    else await new Promise((resolve,reject)=>{const script=path.join(payload,'resources/app/scripts/install-win.mjs'),node=path.join(payload,'resources/app/vendor/node.exe');const child=spawn(node,[script,'--payload',payload],{windowsHide:true,stdio:'ignore',env:process.env});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('Windows update installer failed: '+code)));});
  }finally{removeInstallationTree(root,folder);}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
  const file=process.env.CONTEXT_CONTROL_UPDATE_STATE||path.join(root,'updates.json');
  try{const state=readJSON(file);if(!state?.update)throw Error('没有可安装的更新');atomicJSON(file,{...state,phase:'installing'});await applyWindowsUpdate(state.update);atomicJSON(file,{...readJSON(file),phase:'installed',pid:null,error:null});}
  catch(error){atomicJSON(file,{...readJSON(file),phase:'error',pid:null,error:error.message});process.exitCode=1;}
}
