import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';
import {root,codexHome,ensureRoot,atomicJSON,readJSON} from '../src/paths.mjs';
import {request} from '../src/ipc.mjs';
import {desktopInstallation,windows,powershell} from '../src/platform/index.mjs';
import {verifyWindowsPayload,sha,removeInstallationTree} from '../src/platform/windows-install.mjs';
import {enableAutomaticStartup,disableAutomaticStartup} from '../src/automatic-startup.mjs';
import {inheritedSettings,prepareUpgrade,completeUpgrade} from '../src/upgrade-state.mjs';
import {editOwnedHook} from '../src/hooks.mjs';
import {stopMenuBarEntry,ensureMenuBarEntry} from '../src/menu-bar.mjs';
import {setWindowsIntegration} from '../src/windows-integration.mjs';

if(!windows)throw Error('This installer requires Windows');
const repo=fileURLToPath(new URL('../',import.meta.url)),args=process.argv.slice(2);
const option=name=>args.includes(name)?args[args.indexOf(name)+1]:null;
const pkg=JSON.parse(fs.readFileSync(path.join(repo,'package.json'),'utf8'));
const base=path.resolve(process.env.CONTEXT_CONTROL_APPLICATIONS||path.join(process.env.LOCALAPPDATA,'Programs/ContextManager'));
const previous=readJSON(path.join(root,'settings.json'),{}),hooksFile=path.join(codexHome,'hooks.json');
ensureRoot();
if(args.includes('--uninstall')){
  await stopMenuBarEntry();
  const ownedRegistration=readJSON(path.join(root,'automatic-startup.json'));
  if(!args.includes('--no-auto-start'))disableAutomaticStartup();
  atomicJSON(path.join(root,'integration.json'),{...readJSON(path.join(root,'integration.json'),{}),enabled:false,explicit:false});
  if(previous.hookCommand&&fs.existsSync(hooksFile))editOwnedHook({file:hooksFile,home:root,command:previous.hookCommand,remove:true});
  let retained=false;
  try{
    const state=await request('state',{},3000);retained=state.bridgeCount>0;
    if(!retained){const c=readJSON(path.join(root,'connection.json'));const r=await fetch(`http://127.0.0.1:${c.port}/shutdown`,{method:'POST',headers:{Authorization:`Bearer ${c.token}`}});if(!r.ok)retained=true;else{for(let n=0;n<40;n++){try{process.kill(c.pid,0);await new Promise(r=>setTimeout(r,100));}catch{break;}}try{process.kill(c.pid,0);retained=true;}catch{}}}
  }catch(error){if(!['ENOENT','ECONNREFUSED'].includes(error.code))retained=true;}
  if(!args.includes('--no-shortcut'))powershell('$folder=Join-Path ([Environment]::GetFolderPath("Programs")) "Context Manager";$link=Join-Path $folder "Context Manager.lnk";if(Test-Path -LiteralPath $link){$s=New-Object -ComObject WScript.Shell;$l=$s.CreateShortcut($link);if($l.TargetPath -eq $env:CONTEXT_CONTROL_UI_EXE){Remove-Item -LiteralPath $link}};$key="HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\CodexContextControl";if((Get-ItemProperty -LiteralPath $key -ErrorAction SilentlyContinue).InstallLocation -eq $env:CONTEXT_CONTROL_INSTALL_BASE){Remove-Item -LiteralPath $key}',{CONTEXT_CONTROL_UI_EXE:previous.installedApp||'',CONTEXT_CONTROL_INSTALL_BASE:base});
  if((ownedRegistration||previous.pendingUninstall)&&previous.desktopExecutable){try{const running=powershell('(Get-CimInstance Win32_Process|Where-Object {$_.ExecutablePath -eq $env:CONTEXT_CONTROL_DESKTOP_PATH}|Measure-Object).Count',{CONTEXT_CONTROL_DESKTOP_PATH:previous.desktopExecutable});if(Number(running)>0)retained=true;}catch{retained=true;}}
  atomicJSON(path.join(root,'settings.json'),{...previous,uninstalled:true,pendingUninstall:retained,installedApp:null,hookCommand:null});
  if(!retained){
    const versions=path.join(base,'versions');if(fs.existsSync(versions))for(const entry of fs.readdirSync(versions,{withFileTypes:true})){
      const target=path.join(versions,entry.name);if(!entry.isDirectory()||!/^\d+\.\d+\.\d+-[a-f0-9]{12}$/.test(entry.name)||process.execPath.toLowerCase().startsWith((target+path.sep).toLowerCase()))continue;
      try{verifyWindowsPayload(target);removeInstallationTree(base,target);}catch{retained=true;}
    }
    if(!retained&&fs.existsSync(path.join(root,'bin')))removeInstallationTree(root,path.join(root,'bin'));
  }
  console.log('已卸载接入和托盘入口。预算与备份已保留；现有 Codex 请求继续运行。');
  if(retained)console.log('仍在使用的程序文件已保留，完整退出 Codex 后可再次卸载以清理。');
  process.exit(0);
}
const payload=path.resolve(option('--payload')||path.join(repo,'build',`Context-Manager-${pkg.version}-windows-${process.arch}`,'payload'));
const manifest=verifyWindowsPayload(payload,{version:pkg.version});
const installation=desktopInstallation(),binary=process.env.CONTEXT_CONTROL_REAL_CODEX||installation?.binary;
if(!binary||!fs.existsSync(binary))throw Error('未找到 Windows Codex 桌面运行时。请先安装 Codex。');
const version=spawnSync(binary,['--version'],{encoding:'utf8',windowsHide:true,timeout:10000});
if(version.status!==0||!/^codex-cli \d+\.\d+\.\d+/.test(version.stdout))throw Error('Codex runtime could not be identified');
const identity=sha(path.join(payload,'payload-manifest.json')).slice(0,12),target=path.join(base,'versions',`${manifest.version}-${identity}`);
fs.mkdirSync(path.dirname(target),{recursive:true});
let newlyInstalled=false;
if(!fs.existsSync(target)){
  const stage=target+'.stage-'+process.pid;
  try{fs.cpSync(payload,stage,{recursive:true});verifyWindowsPayload(stage,{version:pkg.version});fs.renameSync(stage,target);newlyInstalled=true;}
  finally{if(fs.existsSync(stage))removeInstallationTree(base,stage);}
}else verifyWindowsPayload(target,{version:pkg.version});
const code=path.join(target,'resources/app'),node=path.join(code,'vendor/node.exe');
const launcher=path.join(code,'windows/native/codex-context.exe'),launcherHash=sha(launcher).slice(0,12),bin=path.join(root,'bin',launcherHash+'-'+identity),shim=path.join(bin,'codex-context.exe');
fs.mkdirSync(bin,{recursive:true});if(!fs.existsSync(shim))fs.copyFileSync(launcher,shim);
for(const name of ['codex-code-mode-host.exe','codex-command-runner.exe','codex-windows-sandbox-setup.exe','codex-windows-sandbox-service.exe','rg.exe']){
  const source=path.join(path.dirname(binary),name),destination=path.join(bin,name);
  if(fs.existsSync(source)&&!fs.existsSync(destination))fs.copyFileSync(source,destination);
}
const oldLauncher=readJSON(path.join(bin,'launcher.json'));
atomicJSON(path.join(bin,'launcher.json'),{node,codeRoot:code,controlHome:root});
const beforeHooks=fs.existsSync(hooksFile)?fs.readFileSync(hooksFile):null;
const beforeStartup=readJSON(path.join(root,'automatic-startup.json'));
const upgrade=prepareUpgrade({home:root,version:pkg.version,previousVersion:previous.productVersion});
const installedApp=path.join(target,'ContextManager.exe'),hookCommand=`"${shim}" --hook`;
let integrationWarning=null;
try{
  await stopMenuBarEntry();
  atomicJSON(path.join(root,'settings.json'),inheritedSettings(previous,{version:1,productVersion:pkg.version,platform:'win32',arch:manifest.arch,realBinary:binary,desktopExecutable:installation?.executable||previous.desktopExecutable,node,codeRoot:code,installedApp,installBase:base,shim,hookCommand:previous.hookCommand||null,uninstalled:false,pendingUninstall:false}));
  // Enable by default; preserve a choice explicitly saved in Settings.
  const integrationPreference=readJSON(path.join(root,'integration.json'),{});
  const optedIn=integrationPreference.explicit===true?integrationPreference.enabled===true:true;
  if(!args.includes('--no-auto-start')){
    try{await setWindowsIntegration(optedIn,{origin:'installer'});}
    catch(error){
      if(!optedIn)throw error;
      // Keep the UI usable and restore native startup if the launch probe or
      // registration fails. A failed automatic attempt is visible in Settings.
      await setWindowsIntegration(false,{origin:'installer'});
      integrationWarning=error.message;
      atomicJSON(path.join(root,'integration.json'),{...readJSON(path.join(root,'integration.json'),{}),explicit:false,requestedEnabled:true,lastError:integrationWarning});
    }
  }
  else{
    atomicJSON(path.join(root,'settings.json'),{...readJSON(path.join(root,'settings.json')),hookCommand:null});
    atomicJSON(path.join(root,'integration.json'),{...readJSON(path.join(root,'integration.json'),{}),enabled:false});
  }
  completeUpgrade({home:root,...upgrade});
}catch(error){
  atomicJSON(path.join(root,'settings.json'),previous);
  if(beforeHooks)fs.writeFileSync(hooksFile,beforeHooks);else fs.rmSync(hooksFile,{force:true});
  if(oldLauncher)atomicJSON(path.join(bin,'launcher.json'),oldLauncher);
  if(!args.includes('--no-auto-start')){try{if(beforeStartup?.value)enableAutomaticStartup(beforeStartup.value);else disableAutomaticStartup();}catch{}}
  if(newlyInstalled)try{removeInstallationTree(base,target);}catch{}
  throw error;
}
if(!args.includes('--no-shortcut')){
  powershell('$s=New-Object -ComObject WScript.Shell;$folder=Join-Path ([Environment]::GetFolderPath("Programs")) "Context Manager";[void][IO.Directory]::CreateDirectory($folder);$l=$s.CreateShortcut((Join-Path $folder "Context Manager.lnk"));$l.TargetPath=$env:CONTEXT_CONTROL_UI_EXE;$l.WorkingDirectory=[IO.Path]::GetDirectoryName($env:CONTEXT_CONTROL_UI_EXE);$l.Save();$key="HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\CodexContextControl";[void](New-Item -Path $key -Force);$values=@{DisplayName="Context Manager";DisplayVersion=$env:CONTEXT_CONTROL_INSTALL_VERSION;Publisher="Fandy-ust";InstallLocation=$env:CONTEXT_CONTROL_INSTALL_BASE;UninstallString=$env:CONTEXT_CONTROL_UNINSTALL;NoModify=1;NoRepair=1};foreach($name in $values.Keys){Set-ItemProperty -LiteralPath $key -Name $name -Value $values[$name]}',{CONTEXT_CONTROL_UI_EXE:installedApp,CONTEXT_CONTROL_INSTALL_BASE:base,CONTEXT_CONTROL_INSTALL_VERSION:pkg.version,CONTEXT_CONTROL_UNINSTALL:`"${node}" "${path.join(code,'scripts/install-win.mjs')}" --uninstall`});
}
if(!args.includes('--no-open'))ensureMenuBarEntry(installedApp);
console.log('Windows 安装完成。接入默认开启；请在当前工作结束后完整退出并重开 Codex。\n可在设置中关闭接入；关闭主窗口后入口保留在系统托盘。');
if(integrationWarning)console.log('本次接入未启用，已保留原生启动入口。请在设置中查看日志并重试：'+integrationWarning);
