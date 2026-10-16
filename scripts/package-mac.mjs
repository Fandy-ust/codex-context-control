import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const repo=fileURLToPath(new URL('../',import.meta.url)),version=JSON.parse(fs.readFileSync(path.join(repo,'package.json'))).version;
if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('This release currently targets Apple Silicon macOS.');
const sourceRevision=spawnSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).stdout.trim();
const dirty=()=>spawnSync('git',['status','--porcelain'],{cwd:repo,encoding:'utf8'}).stdout.trim().length>0;
if(process.argv.includes('--release')&&dirty())throw Error('Release packaging requires a clean working tree');
const pin=JSON.parse(fs.readFileSync(path.join(repo,'packaging/node-runtime.json'))),archive=pin.archives.arm64;
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function run(command,args){const r=spawnSync(command,args,{cwd:repo,stdio:'inherit'});if(r.error||r.status!==0)throw Error(command+' failed');}
const cache=path.join(repo,'build/vendor');fs.mkdirSync(cache,{recursive:true});const tarball=path.join(cache,archive.file);
if(!fs.existsSync(tarball)||hash(tarball)!==archive.sha256){
 const response=await fetch(archive.url);if(!response.ok)throw Error('Node download failed: '+response.status);
 const temporary=tarball+'.tmp';fs.writeFileSync(temporary,Buffer.from(await response.arrayBuffer()));if(hash(temporary)!==archive.sha256){fs.rmSync(temporary);throw Error('Node archive checksum mismatch');}fs.renameSync(temporary,tarball);
}
run('/usr/bin/tar',['-xzf',tarball,'-C',cache,`node-${pin.version}-darwin-arm64/bin/node`,`node-${pin.version}-darwin-arm64/LICENSE`]);
const nodeRoot=path.join(cache,`node-${pin.version}-darwin-arm64`);
if(!process.argv.includes('--use-built-panel'))run(process.execPath,['scripts/build-mac.mjs']);
const built=path.join(repo,'build/Codex Context Control.app');if(!fs.existsSync(path.join(built,'Contents/MacOS/ContextControl')))throw Error('Build the native panel first');
const output=path.join(repo,'build/distribution'),app=path.join(output,'Install Context Manager.app'),resources=path.join(app,'Contents/Resources'),payload=path.join(resources,'payload');
fs.rmSync(app,{recursive:true,force:true});fs.mkdirSync(path.join(app,'Contents/MacOS'),{recursive:true});fs.mkdirSync(payload,{recursive:true});
fs.mkdirSync(path.join(payload,'src'));for(const name of fs.readdirSync(path.join(repo,'src'))){if(name.endsWith('.mjs')||name==='api-prices.json')fs.copyFileSync(path.join(repo,'src',name),path.join(payload,'src',name));}
fs.mkdirSync(path.join(payload,'runtime-patches'));const patchPin=JSON.parse(fs.readFileSync(path.join(repo,'runtime-patches/manifest.json')));for(const name of ['manifest.json','LICENSE','CODEX-NOTICE',patchPin.baseVersion+'.patch'])fs.copyFileSync(path.join(repo,'runtime-patches',name),path.join(payload,'runtime-patches',name));
const production=spawnSync('npm',['ls','--omit=dev','--all','--parseable'],{cwd:repo,encoding:'utf8'});if(production.status!==0)throw Error('Production dependencies are incomplete; run npm ci first');
fs.mkdirSync(path.join(payload,'node_modules'));for(const directory of production.stdout.trim().split('\n').filter(p=>p!==repo.replace(/\/$/,''))){const relative=path.relative(repo,directory);if(!relative.startsWith('node_modules'+path.sep)||fs.lstatSync(directory).isSymbolicLink())throw Error('Unsupported production dependency path');fs.cpSync(directory,path.join(payload,relative),{recursive:true});} 
for(const file of ['package.json','package-lock.json','LICENSE'])fs.copyFileSync(path.join(repo,file),path.join(payload,file));
fs.mkdirSync(path.join(payload,'scripts'));for(const name of ['install.mjs','install-patched-runtime.mjs'])fs.copyFileSync(path.join(repo,'scripts',name),path.join(payload,'scripts',name));
fs.mkdirSync(path.join(payload,'build'));fs.cpSync(built,path.join(payload,'build/Codex Context Control.app'),{recursive:true});
fs.mkdirSync(path.join(payload,'vendor'));fs.copyFileSync(path.join(nodeRoot,'bin/node'),path.join(payload,'vendor/node'));fs.chmodSync(path.join(payload,'vendor/node'),0o755);fs.copyFileSync(path.join(nodeRoot,'LICENSE'),path.join(payload,'vendor/Node-LICENSE.txt'));
run('xcrun',['swiftc','-parse-as-library','-O','-target','arm64-apple-macos14.0','packaging/Installer.swift','-o',path.join(app,'Contents/MacOS/Installer'),'-framework','SwiftUI','-framework','AppKit','-framework','CryptoKit']);
fs.writeFileSync(path.join(app,'Contents/Info.plist'),`<?xml version="1.0"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>io.github.codex-context-control.installer</string><key>CFBundleName</key><string>Install Context Manager</string><key>CFBundleExecutable</key><string>Installer</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>${version}</string><key>LSMinimumSystemVersion</key><string>14.0</string></dict></plist>`);
const identity=process.env.CONTEXT_CONTROL_SIGN_IDENTITY;
if(identity){
 run('/usr/bin/codesign',['--force','--options','runtime','--timestamp','--entitlements','packaging/node-entitlements.plist','--sign',identity,path.join(payload,'vendor/node')]);
 run('/usr/bin/codesign',['--force','--options','runtime','--timestamp','--sign',identity,path.join(payload,'build/Codex Context Control.app')]);
}
if(identity){const signed=spawnSync('/usr/bin/codesign',['-d','--verbose=4',path.join(payload,'build/Codex Context Control.app')],{encoding:'utf8'});if(!/Authority=Developer ID Application:/.test(signed.stderr))throw Error('Use a Developer ID Application identity for distribution');}
const files={};let bytes=0;
function scan(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isSymbolicLink())throw Error('Unexpected symlink in package: '+file);if(entry.isDirectory())scan(file);else{const relative=path.relative(payload,file).split(path.sep).join('/');if(/(^|\/)(auth\.json|state\.json|connection\.json|\.env)$/.test(relative))throw Error('Private runtime file in payload');files[relative]=hash(file);bytes+=fs.statSync(file).size;}}}
scan(payload);fs.writeFileSync(path.join(resources,'payload-manifest.json'),JSON.stringify({version,sourceRevision,dirtyWorkingTree:dirty(),arch:'arm64',nodeVersion:pin.version,developerIDSigned:!!identity,files},null,2)+'\n');
run('/usr/bin/codesign',['--force',...(identity?['--options','runtime','--timestamp']:[]),'--sign',identity||'-',app]);run('/usr/bin/codesign',['--verify','--strict','--deep',app]);
const zip=path.join(output,`Context-Manager-${version}-macos-arm64.zip`);fs.rmSync(zip,{force:true});run('/usr/bin/ditto',['-c','-k','--sequesterRsrc','--keepParent',app,zip]);
fs.writeFileSync(path.join(output,'README-FIRST.txt'),`Context Manager ${version} — Apple Silicon 测试包\n\n1. 先安装 Codex / ChatGPT 桌面客户端。\n2. 打开 Install Context Manager.app，点击安装 / 更新。无需 Node、npm、Homebrew 或 Xcode。\n3. 完整退出并重开 Codex，菜单栏将出现机器人图标。\n4. Hook stats 如需显示，在 Codex 的 /hooks 中审核新增 hook。\n\n当前包尚未 Apple 公证。确认来源后，如 macOS 阻止打开，请按系统设置 → 隐私与安全 → 仍要打开操作。不要关闭系统安全功能。\n安装器可在完成后删除；主程序不依赖下载目录。可再次打开安装器移除安装。\n本包不包含大型可选修复核心，也不包含作者的账号、聊天记录或配置。\n项目仓库保持私有，仅向所有者授权的测试者提供。\nhttps://github.com/Fandy-ust/codex-context-control\n`);
run('/usr/bin/zip',['-q','-j',zip,path.join(output,'README-FIRST.txt')]);
fs.writeFileSync(zip+'.sha256',hash(zip)+'  '+path.basename(zip)+'\n');
if(process.argv.includes('--release')&&dirty())throw Error('Source changed during packaging; do not publish this artifact');
const result={version,sourceRevision,dirtyWorkingTree:dirty(),arch:'arm64',nodeVersion:pin.version,payloadFiles:Object.keys(files).length,uncompressedPayloadBytes:bytes,archiveBytes:fs.statSync(zip).size,developerIDSigned:!!identity,notarized:false,archive:path.relative(repo,zip)};
fs.writeFileSync(path.join(output,'package-info.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
