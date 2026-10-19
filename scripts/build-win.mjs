import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {rcedit} from 'rcedit';
import {powershell} from '../src/platform/index.mjs';
import {compileWindowsInstaller} from './windows-installer.mjs';
import {pruneTokenizer} from './prune-tokenizer.mjs';
import {pruneElectron} from './prune-electron.mjs';

if(process.platform!=='win32')throw Error('Build Windows packages on Windows');
const repo=fileURLToPath(new URL('../',import.meta.url)),pkg=JSON.parse(fs.readFileSync(path.join(repo,'package.json'),'utf8'));
const contracts=spawnSync(process.execPath,[path.join(repo,'scripts/check-architecture.mjs')],{stdio:'inherit',windowsHide:true});
if(contracts.status!==0)process.exit(contracts.status||1);
const arch=process.env.CONTEXT_CONTROL_BUILD_ARCH||process.arch;
if(!['x64','arm64'].includes(arch)||arch!==process.arch)throw Error('Build with a Node/Electron runtime matching the target architecture');
const compiler=path.join(process.env.SystemRoot,'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
const out=path.join(repo,'build',`Context-Manager-${pkg.version}-windows-${arch}`);
fs.mkdirSync(out,{recursive:true});
fs.cpSync(path.join(repo,'docs'),path.join(out,'docs'),{recursive:true});
for(const name of ['README.md','README.zh-CN.md','LICENSE','THIRD_PARTY_NOTICES.md'])fs.copyFileSync(path.join(repo,name),path.join(out,name));
for(const [source,target]of [['INSTALL_WINDOWS.md','README-Windows.md'],['WINDOWS_UI_CHECKLIST.md','UI-Checklist.md']]){
  const text=fs.readFileSync(path.join(repo,'docs',source),'utf8').replace(/\]\((?!https?:\/\/)([^)]+\.md)\)/g,'](docs/$1)');fs.writeFileSync(path.join(out,target),text);
}
const native=path.join(repo,'build/windows-native');fs.mkdirSync(native,{recursive:true});
const images=JSON.parse(powershell('Add-Type -AssemblyName System.Drawing;$source=[Drawing.Image]::FromFile($env:CONTEXT_CONTROL_ICON_SOURCE);$result=@();foreach($size in @(16,24,32,48,64,256)){$bitmap=New-Object Drawing.Bitmap($size,$size);$g=[Drawing.Graphics]::FromImage($bitmap);$g.InterpolationMode=[Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic;$g.DrawImage($source,0,0,$size,$size);$stream=New-Object IO.MemoryStream;$bitmap.Save($stream,[Drawing.Imaging.ImageFormat]::Png);$result+=@{size=$size;data=[Convert]::ToBase64String($stream.ToArray())};$g.Dispose();$bitmap.Dispose();$stream.Dispose()};$source.Dispose();ConvertTo-Json -InputObject $result -Compress',{CONTEXT_CONTROL_ICON_SOURCE:path.join(repo,'macos/Assets/ContextManager.png')}));
const iconHeader=Buffer.alloc(6+images.length*16);iconHeader.writeUInt16LE(1,2);iconHeader.writeUInt16LE(images.length,4);let iconOffset=iconHeader.length;
const iconImages=images.map((image,i)=>{const png=Buffer.from(image.data,'base64'),at=6+i*16;iconHeader[at]=iconHeader[at+1]=image.size===256?0:image.size;iconHeader.writeUInt16LE(1,at+4);iconHeader.writeUInt16LE(32,at+6);iconHeader.writeUInt32LE(png.length,at+8);iconHeader.writeUInt32LE(iconOffset,at+12);iconOffset+=png.length;return png;});
const icon=path.join(native,'ContextManager.ico');fs.writeFileSync(icon,Buffer.concat([iconHeader,...iconImages]));
for(const [source,target,refs]of [['Launcher.cs','codex-context.exe',['System.Web.Extensions.dll']]]){
  const r=spawnSync(compiler,['/nologo','/optimize+','/target:winexe','/platform:anycpu','/win32icon:'+icon,...refs.map(r=>'/reference:'+r),'/out:'+path.join(native,target),path.join(repo,'windows/native',source)],{encoding:'utf8',windowsHide:true});
  if(r.error||r.status!==0)throw Error(r.error?.message||r.stdout+r.stderr);
}
compileWindowsInstaller({output:path.join(native,'Install Context Manager.exe'),icon});
if(process.argv.includes('--native-only')){console.log(native);process.exit(0);}
const electron=path.join(repo,'node_modules/electron/dist');
if(!fs.existsSync(path.join(electron,'electron.exe'))){
  // Recent Electron packages defer the binary download until first launch.
  // Packaging never launches the UI, so prepare the pinned binary explicitly.
  const installer=path.join(repo,'node_modules/electron/install.js');
  if(!fs.existsSync(installer))throw Error('Run npm ci first to install Electron');
  const install=spawnSync(process.execPath,[installer],{cwd:repo,stdio:'inherit',windowsHide:true,timeout:300000,env:{...process.env,ELECTRON_INSTALL_ARCH:arch,ELECTRON_INSTALL_PLATFORM:'win32'}});
  if(install.error||install.status!==0||!fs.existsSync(path.join(electron,'electron.exe')))throw Error(install.error?.message||'Electron binary preparation failed');
}
const payload=path.join(out,'payload');fs.rmSync(payload,{recursive:true,force:true});fs.mkdirSync(payload,{recursive:true});fs.cpSync(electron,payload,{recursive:true});
pruneElectron(payload);
fs.renameSync(path.join(payload,'electron.exe'),path.join(payload,'ContextManager.exe'));
await rcedit(path.join(payload,'ContextManager.exe'),{icon,'file-version':pkg.version,'product-version':pkg.version,'version-string':{ProductName:'Context Manager',FileDescription:'Context Manager',CompanyName:'Fandy-ust',OriginalFilename:'ContextManager.exe',InternalName:'ContextManager'}});
const app=path.join(payload,'resources/app');fs.mkdirSync(app,{recursive:true});
for(const name of ['src','scripts','desktop','runtime-patches','windows','skills'])fs.cpSync(path.join(repo,name),path.join(app,name),{recursive:true});
for(const name of ['LICENSE','THIRD_PARTY_NOTICES.md'])fs.copyFileSync(path.join(repo,name),path.join(app,name));
fs.mkdirSync(path.join(app,'macos/Assets'),{recursive:true});fs.copyFileSync(path.join(repo,'macos/Assets/ContextManager.png'),path.join(app,'macos/Assets/ContextManager.png'));
fs.mkdirSync(path.join(app,'node_modules'),{recursive:true});
for(const name of ['js-tiktoken','base64-js'])fs.cpSync(path.join(repo,'node_modules',name),path.join(app,'node_modules',name),{recursive:true});
pruneTokenizer(path.join(app,'node_modules'));
fs.mkdirSync(path.join(app,'vendor'),{recursive:true});fs.copyFileSync(process.execPath,path.join(app,'vendor/node.exe'));
const licenseCache=path.join(repo,'build/licenses',`Node-${process.version}-LICENSE.txt`);fs.mkdirSync(path.dirname(licenseCache),{recursive:true});
if(!fs.existsSync(licenseCache)){
  const response=await fetch(`https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`,{signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('Unable to retrieve the bundled Node license');const license=await response.text();if(!license.includes('Node.js'))throw Error('Invalid Node license response');fs.writeFileSync(licenseCache,license);
}
fs.copyFileSync(licenseCache,path.join(app,'vendor/Node-LICENSE.txt'));
fs.copyFileSync(path.join(native,'codex-context.exe'),path.join(app,'windows/native/codex-context.exe'));
fs.copyFileSync(path.join(native,'Install Context Manager.exe'),path.join(out,'Install Context Manager.exe'));
const sourceHash=crypto.createHash('sha256');
for(const directory of ['src','desktop','windows','scripts']){
  const hashTree=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const file=path.join(dir,entry.name);if(entry.isDirectory())hashTree(file);else sourceHash.update(path.relative(app,file)).update(fs.readFileSync(file));}};hashTree(path.join(app,directory));
}
const buildId=sourceHash.digest('hex').slice(0,20);
fs.writeFileSync(path.join(app,'package.json'),JSON.stringify({...pkg,buildId,main:'desktop/main.mjs',devDependencies:undefined},null,2)+'\n');
const files={};
function visit(directory,base=''){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const relative=base?base+'/'+entry.name:entry.name;if(relative==='payload-manifest.json')continue;if(entry.isSymbolicLink())throw Error('Package contains a symbolic link');if(entry.isDirectory())visit(path.join(directory,entry.name),relative);else files[relative]=crypto.createHash('sha256').update(fs.readFileSync(path.join(directory,entry.name))).digest('hex');}}
visit(payload);
const commit=spawnSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8',windowsHide:true}).stdout?.trim()||'unknown';
fs.writeFileSync(path.join(payload,'payload-manifest.json'),JSON.stringify({version:pkg.version,buildId,platform:'win32',arch,commit,files},null,2)+'\n');
console.log(out);

// The public build command produces the self-contained installer in one pass.
if(!process.argv.includes('--directory-only'))await import('./package-win.mjs');
