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
const panelPlist=path.join(built,'Contents/Info.plist');
const plistValue=key=>{const r=spawnSync('/usr/libexec/PlistBuddy',['-c','Print :'+key,panelPlist],{encoding:'utf8'});if(r.status!==0)throw Error('Missing panel metadata: '+key);return r.stdout.trim();};
if(plistValue('CFBundleShortVersionString')!==version)throw Error('Built panel is stale; rebuild before packaging');
const iconName=plistValue('CFBundleIconFile');
if(path.basename(iconName)!==iconName)throw Error('Invalid panel icon name');
const iconSource=path.join(built,'Contents/Resources',iconName+'.icns');
const output=path.join(repo,'build/distribution'),app=path.join(output,'Install Context Manager.app'),resources=path.join(app,'Contents/Resources'),payload=path.join(resources,'payload');
fs.rmSync(app,{recursive:true,force:true});fs.mkdirSync(path.join(app,'Contents/MacOS'),{recursive:true});fs.mkdirSync(payload,{recursive:true});
fs.copyFileSync(iconSource,path.join(resources,iconName+'.icns'));
fs.copyFileSync(path.join(repo,'src/locales/en.json'),path.join(resources,'localization-en.json'));
fs.mkdirSync(path.join(payload,'src/locales'),{recursive:true});fs.copyFileSync(path.join(repo,'src/locales/en.json'),path.join(payload,'src/locales/en.json'));
fs.mkdirSync(path.join(payload,'src'),{recursive:true});for(const name of fs.readdirSync(path.join(repo,'src'))){if(name.endsWith('.mjs')||name==='api-prices.json')fs.copyFileSync(path.join(repo,'src',name),path.join(payload,'src',name));}
fs.mkdirSync(path.join(payload,'runtime-patches'));const patchPin=JSON.parse(fs.readFileSync(path.join(repo,'runtime-patches/manifest.json')));for(const name of ['manifest.json','LICENSE','CODEX-NOTICE',patchPin.baseVersion+'.patch'])fs.copyFileSync(path.join(repo,'runtime-patches',name),path.join(payload,'runtime-patches',name));
const production=spawnSync('npm',['ls','--omit=dev','--all','--parseable'],{cwd:repo,encoding:'utf8'});if(production.status!==0)throw Error('Production dependencies are incomplete; run npm ci first');
fs.mkdirSync(path.join(payload,'node_modules'));for(const directory of production.stdout.trim().split('\n').filter(p=>p!==repo.replace(/\/$/,''))){const relative=path.relative(repo,directory);if(!relative.startsWith('node_modules'+path.sep)||fs.lstatSync(directory).isSymbolicLink())throw Error('Unsupported production dependency path');fs.cpSync(directory,path.join(payload,relative),{recursive:true});} 
const tokenizer=path.join(payload,'node_modules/js-tiktoken');
for(const name of fs.readdirSync(path.join(tokenizer,'dist'))){
 const keep=name==='lite.js'||/^chunk-.*\.js$/.test(name)||name==='ranks';
 if(!keep)fs.rmSync(path.join(tokenizer,'dist',name),{recursive:true,force:true});
}
for(const name of fs.readdirSync(path.join(tokenizer,'dist/ranks')))if(name!=='o200k_base.js')fs.rmSync(path.join(tokenizer,'dist/ranks',name));
for(const file of ['package.json','package-lock.json','LICENSE','THIRD_PARTY_NOTICES.md'])fs.copyFileSync(path.join(repo,file),path.join(payload,file));
fs.mkdirSync(path.join(payload,'scripts'));for(const name of ['install.mjs'])fs.copyFileSync(path.join(repo,'scripts',name),path.join(payload,'scripts',name));
fs.mkdirSync(path.join(payload,'build'));fs.cpSync(built,path.join(payload,'build/Codex Context Control.app'),{recursive:true});
fs.cpSync(path.join(repo,'third-party-licenses'),path.join(payload,'third-party-licenses'),{recursive:true});
fs.mkdirSync(path.join(payload,'vendor'));fs.copyFileSync(path.join(nodeRoot,'bin/node'),path.join(payload,'vendor/node'));fs.chmodSync(path.join(payload,'vendor/node'),0o755);fs.copyFileSync(path.join(nodeRoot,'LICENSE'),path.join(payload,'vendor/Node-LICENSE.txt'));
run('xcrun',['swiftc','-parse-as-library','-O','-target','arm64-apple-macos14.0','macos/Localization.swift','packaging/Installer.swift','-o',path.join(app,'Contents/MacOS/Installer'),'-framework','SwiftUI','-framework','AppKit','-framework','CryptoKit']);
fs.writeFileSync(path.join(app,'Contents/Info.plist'),`<?xml version="1.0"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>io.github.codex-context-control.installer</string><key>CFBundleName</key><string>Install Context Manager</string><key>CFBundleExecutable</key><string>Installer</string><key>CFBundleIconFile</key><string>${iconName}</string><key>CFBundleLocalizations</key><array><string>en</string><string>zh-Hans</string></array><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>${version}</string><key>LSMinimumSystemVersion</key><string>14.0</string></dict></plist>`);
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
fs.writeFileSync(path.join(output,'README-FIRST.txt'),`Context Manager ${version} — Apple Silicon preview / 测试版

English | 中文

1. Install Codex / ChatGPT Desktop first.
2. Open the DMG, open Install Context Manager.app, and choose Install / Update.
3. Fully quit and reopen Codex after initial installation or a bridge upgrade.
4. Click the ring icon in the menu bar. Choose Automatic (time zone), 中文, or English in the app or installer.
5. Optionally review the Stop hook in Codex’s /hooks for Hook stats.

No Node, npm, Homebrew, Xcode, or administrator password is required. Budgets, language, and feature preferences are preserved on updates. The installer can be deleted after installation or reopened to uninstall.

The early-compaction fix is disabled because it replaces the Codex core with a modified binary lacking the official Codex signing identity, which can prevent Computer Use from working. The 920K extension only changes configuration and keeps the official runtime.

This preview is locally signed, not Developer ID signed or Apple notarized. If a trusted download is blocked, follow System Settings → Privacy & Security → Open Anyway. Do not disable system security.

Original project code is MIT licensed. Third-party components retain their licenses. This package excludes credentials, chat history, personal configuration, and the large optional patched Codex runtime.

提前压缩修复已停用：它需要替换 Codex 核心，修改版缺少 Codex 官方签名身份，会导致 Computer Use 无法使用。920K 扩展仅调整配置，继续使用官方运行时，无需修改核心。

中文：先安装 Codex 桌面客户端，打开 DMG 后打开安装器，选择「安装 / 更新」，再完整退出并重开 Codex。菜单栏圆环提供设置入口，App 与安装器均可选择「自动（按时区）／中文／English」。更新保留预算、语言和开关。本测试包尚未 Apple 公证；确认来源后按「隐私与安全」提示允许打开。项目使用 MIT 许可，第三方组件保留各自许可。

https://github.com/Fandy-ust/codex-context-control
`);
const image=path.join(output,`Context-Manager-${version}-macos-arm64.dmg`);
const imageRoot=fs.mkdtempSync(path.join(output,'dmg-stage-'));
try{
 fs.cpSync(app,path.join(imageRoot,path.basename(app)),{recursive:true});
 fs.copyFileSync(path.join(output,'README-FIRST.txt'),path.join(imageRoot,'README-FIRST.txt'));
 run('/usr/bin/hdiutil',['create','-ov','-format','UDZO','-volname','Context Manager','-srcfolder',imageRoot,image]);
}finally{fs.rmSync(imageRoot,{recursive:true,force:true});}
fs.writeFileSync(image+'.sha256',hash(image)+'  '+path.basename(image)+'\n');
if(process.argv.includes('--release')&&dirty())throw Error('Source changed during packaging; do not publish this artifact');
const result={version,sourceRevision,dirtyWorkingTree:dirty(),arch:'arm64',nodeVersion:pin.version,payloadFiles:Object.keys(files).length,uncompressedPayloadBytes:bytes,archiveBytes:fs.statSync(image).size,developerIDSigned:!!identity,notarized:false,archive:path.relative(repo,image)};
fs.writeFileSync(path.join(output,'package-info.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
