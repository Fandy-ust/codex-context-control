import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {root,codexHome,ensureRoot,atomicJSON,readJSON,realBinary} from '../src/paths.mjs';
import {enableAutomaticStartup,disableAutomaticStartup} from '../src/automatic-startup.mjs';
import {ensureMenuBarEntry,stopMenuBarEntry} from '../src/menu-bar.mjs';

const repo=fileURLToPath(new URL('../',import.meta.url));
const applications=process.env.CONTEXT_CONTROL_APPLICATIONS || path.join(os.homedir(),'Applications');
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const nodeBinary=(process.env.PATH||'').split(path.delimiter).map(dir=>path.join(dir,'node')).find(file=>{try{return fs.realpathSync(file)===fs.realpathSync(process.execPath);}catch{return false;}})||process.execPath;
const hooksFile=path.join(codexHome,'hooks.json');
const installedApp=path.join(applications,'Codex Context Control.app');
const launcherApp=path.join(applications,'Codex Context Launcher.app');
function editHook(command,remove=false){
  const before=fs.existsSync(hooksFile)?fs.readFileSync(hooksFile):null;
  const doc=before?JSON.parse(before):{};if(!doc||typeof doc!=='object'||Array.isArray(doc))throw new Error('hooks.json 根节点无效');
  if(doc.hooks!=null&&(typeof doc.hooks!=='object'||Array.isArray(doc.hooks)))throw new Error('hooks 配置无效');
  const groups=doc.hooks?.Stop||[];if(!Array.isArray(groups))throw new Error('Stop hooks 配置无效');
  const own=group=>group?.hooks?.some(h=>h.type==='command'&&h.command===command);
  const kept=groups.flatMap(group=>{if(!own(group))return [group];const hooks=group.hooks.filter(h=>h.command!==command);return hooks.length?[{...group,hooks}]:[];});
  if(!remove)kept.push({hooks:[{type:'command',command,timeout:2,statusMessage:'Context Control: reading this chat budget'}]});
  doc.hooks={...doc.hooks,Stop:kept};
  const backup=path.join(root,'backups',new Date().toISOString().replaceAll(':','-')+'-'+crypto.randomBytes(3).toString('hex'));fs.mkdirSync(backup,{recursive:true,mode:0o700});
  if(before)fs.writeFileSync(path.join(backup,'hooks.json'),before,{mode:0o600});
  if((fs.existsSync(hooksFile)?fs.readFileSync(hooksFile).toString('base64'):null)!==(before?before.toString('base64'):null))throw new Error('hooks.json 在安装期间变化，已取消写入');
  atomicJSON(hooksFile,doc);
}
function shellFile(file,body){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'#!/bin/sh\nset -eu\n'+body+'\n',{mode:0o700});fs.chmodSync(file,0o700);}
ensureRoot();
if(process.argv.includes('--uninstall')){
  disableAutomaticStartup();
  await stopMenuBarEntry(installedApp);
  const settings=readJSON(path.join(root,'settings.json'),{});if(settings.hookCommand)editHook(settings.hookCommand,true);
  const connection=readJSON(path.join(root,'connection.json'),{});if(connection.pid)try{process.kill(connection.pid,'SIGTERM');}catch{}
  for(const app of [installedApp,launcherApp])fs.rmSync(app,{recursive:true,force:true});
  console.log('已移除自动接入、应用和本项目的 hook；保留预算、备份与代码目录。现有运行时将在正常退出时关闭。');
}else{
  if(process.platform!=='darwin')throw new Error('首版安装程序面向 macOS；核心测试可在 Node.js 上运行。');
  const binary=realBinary();if(!fs.existsSync(binary))throw new Error('未找到 Codex 二进制文件');
  if(!fs.existsSync(path.join(repo,'node_modules/js-tiktoken/package.json'))){
    const dependencies=spawnSync('npm',['ci','--omit=dev','--ignore-scripts'],{cwd:repo,stdio:'inherit'});if(dependencies.status!==0)process.exit(dependencies.status||1);
  }
  const builtPanel=path.join(repo,'build/Codex Context Control.app');
  if(!process.argv.includes('--use-built-panel')||!fs.existsSync(path.join(builtPanel,'Contents/MacOS/ContextControl'))){
    const build=spawnSync(process.execPath,[path.join(repo,'scripts/build-mac.mjs')],{stdio:'inherit'});if(build.status!==0)process.exit(build.status||1);
  }
  const oldVersion=readJSON(path.join(root,'code/package.json'),{})?.version;
  const extensionFile=path.join(root,'context-extension.json');
  if(!fs.existsSync(extensionFile)&&/^0\.(12|13)\./.test(oldVersion??''))atomicJSON(extensionFile,{enabled:true,migratedFrom:oldVersion,updatedAt:Date.now()});
  const code=path.join(root,'code');fs.mkdirSync(code,{recursive:true,mode:0o700});
  for(const dir of ['src','scripts','runtime-patches'])fs.cpSync(path.join(repo,dir),path.join(code,dir),{recursive:true});
  fs.copyFileSync(path.join(repo,'package.json'),path.join(code,'package.json'));
  fs.copyFileSync(path.join(repo,'package-lock.json'),path.join(code,'package-lock.json'));
  fs.cpSync(path.join(repo,'node_modules'),path.join(code,'node_modules'),{recursive:true});
  const shim=path.join(root,'bin/codex-context');
  shellFile(shim,`exec ${quote(nodeBinary)} ${quote(path.join(code,'src/wrapper.mjs'))} "$@"`);
  const hookCommand=`${quote(nodeBinary)} ${quote(path.join(code,'src/cli.mjs'))} hook`;
  const appPath=binary.split('/Contents/')[0];
  const info=spawnSync('/usr/libexec/PlistBuddy',['-c','Print :CFBundleExecutable',path.join(appPath,'Contents/Info.plist')],{encoding:'utf8'});
  if(info.status!==0)throw new Error('无法读取 Codex 应用入口');
  const bundle=spawnSync('/usr/libexec/PlistBuddy',['-c','Print :CFBundleIdentifier',path.join(appPath,'Contents/Info.plist')],{encoding:'utf8'}).stdout.trim();
  const desktopExecutable=path.join(appPath,'Contents/MacOS',info.stdout.trim());
  const previousSettings=readJSON(path.join(root,'settings.json'),{});
  if(previousSettings.hookCommand&&previousSettings.hookCommand!==hookCommand)editHook(previousSettings.hookCommand,true);
  atomicJSON(path.join(root,'settings.json'),{version:1,realBinary:binary,node:nodeBinary,hookCommand,desktopExecutable,desktopBundleId:bundle,shim,installedApp,launcherApp});
  // Keep native runtime helpers discoverable beside the shim without changing signed apps.
  const binDir=path.dirname(binary);for(const name of fs.readdirSync(binDir)){
    if(name==='codex')continue;const link=path.join(root,'bin',name);try{fs.unlinkSync(link);}catch{}
    try{fs.symlinkSync(path.join(binDir,name),link);}catch{}
  }
  await stopMenuBarEntry(installedApp);
  fs.mkdirSync(applications,{recursive:true});fs.rmSync(installedApp,{recursive:true,force:true});
  fs.cpSync(builtPanel,installedApp,{recursive:true});
  // Preserve the signed native bundle: CFBundleExecutable must name the real
  // application process so macOS can attribute its menu-bar entry correctly.
  editHook(hookCommand);
  if(!process.argv.includes('--no-auto-start')){
    enableAutomaticStartup(shim);
    fs.rmSync(launcherApp,{recursive:true,force:true});
    fs.rmSync(path.join(code,'src/launch-desktop.mjs'),{force:true});
    const entry=ensureMenuBarEntry(installedApp);
    if(entry.error)throw new Error(entry.error);
  }
  console.log(`已安装：${installedApp}\n菜单栏 Context Manager 机器人图标提供聊天概览和设置入口。照常打开原来的 Codex，预算控制会自动接入；首次安装后请正常重开一次客户端。\n请在 Codex 的 /hooks 中审核并信任新增 hook；安装程序不会生成信任记录。`);
}
