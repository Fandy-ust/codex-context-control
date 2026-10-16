// Install a locally built/verified artifact without enabling it or replacing Codex.app.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {root} from '../src/paths.mjs';
import {runtimeFixPin,validateRuntimePackage} from '../src/runtime-fix.mjs';
const source=path.resolve(process.argv[2]??'build/patched-runtime');
const checked=validateRuntimePackage(source);
const version=spawnSync(checked.binary,['--version'],{encoding:'utf8',timeout:5000});
if(version.status!==0||version.stdout.trim()!==`codex-cli ${runtimeFixPin.baseVersion}`)throw Error('Runtime version check failed');
if(process.platform==='darwin'){
  const signature=spawnSync('/usr/bin/codesign',['--verify','--strict',checked.binary],{stdio:'inherit'});
  if(signature.status!==0)throw Error('Runtime signature check failed');
}
const parent=path.join(root,'runtimes'),target=path.join(parent,runtimeFixPin.id);
fs.mkdirSync(parent,{recursive:true,mode:0o700});
if(fs.existsSync(target)){
  const current=validateRuntimePackage(target);
  if(current.manifest.binarySHA256!==checked.manifest.binarySHA256)throw Error('A different build already owns this patch ID; preserve running instances and use a new patch ID');
}else{
  const stage=fs.mkdtempSync(path.join(parent,'.install-'));
  try{for(const file of ['codex','runtime.json','validation.json','CODEX-LICENSE','PATCH-LICENSE'])fs.copyFileSync(path.join(source,file),path.join(stage,file));
    fs.copyFileSync(new URL('../runtime-patches/CODEX-NOTICE',import.meta.url),path.join(stage,'CODEX-NOTICE'));
    fs.chmodSync(path.join(stage,'codex'),0o755);validateRuntimePackage(stage);fs.renameSync(stage,target);
  }finally{fs.rmSync(stage,{recursive:true,force:true});}
}
console.log('修复包已安装；开关设置保持原值，首次安装默认关闭。');
