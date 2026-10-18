import {app,BrowserWindow,Tray,Menu,ipcMain,nativeImage,nativeTheme,screen,globalShortcut,shell,dialog} from 'electron';
import fs from 'node:fs';
import {assertControlOperation} from '../src/contracts/control-api.mjs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {trayState} from '../src/tray-state.mjs';
import {defaultRoot} from '../src/platform/index.mjs';
import {createShortcutManager} from '../src/ui-shortcut.mjs';
import {selectedQuota,quotaRemaining,quotaWindows,quotaStale} from '../src/quota-display.mjs';
import {quotaIconBitmap} from './quota-icon.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),repo=path.dirname(here),args=process.argv;
if(app.isPackaged)process.chdir(repo);
if(fs.existsSync(path.join(repo,'vendor/node.exe')))process.env.CONTEXT_CONTROL_NODE=path.join(repo,'vendor/node.exe');
const demo=args.includes('--demo'),smoke=args.includes('--smoke-test');
const liveHome=process.env.CONTEXT_CONTROL_LIVE_HOME||defaultRoot();
if(smoke)setTimeout(()=>{console.error('UI_SMOKE_FAILED startup timeout');app.exit(1);},30000).unref();
if(demo&&!process.env.CONTEXT_CONTROL_HOME)process.env.CONTEXT_CONTROL_HOME=path.join(os.tmpdir(),'context-manager-demo');
const {root,readJSON,atomicJSON,ensureRoot,settings}=await import('../src/paths.mjs');
const {windowsIntegrationStatus,setWindowsIntegration,codexLaunchEnvironment}=await import('../src/windows-integration.mjs');
const {integrationLogDirectory}=await import('../src/diagnostic-log.mjs');
const {ensureDaemon}=await import('../src/service.mjs');
const {resolveLanguage,languagePreference,localize}=await import('../src/localization.mjs');
const {demoState,demoStatistics}=await import('./demo.mjs');
const pkg=JSON.parse(fs.readFileSync(path.join(repo,'package.json'),'utf8'));
app.setName('Context Manager');app.setAppUserModelId('io.github.codex-context-control');
app.setPath('userData',path.join(root,'ui-profile'));
if(!app.requestSingleInstanceLock()){app.quit();}else{
let main,trayWindow,tray,quitting=false,lastState=null,serviceOnline=false,ready=false,timer,lastIcon='',menuDragging=false,lastServiceAttempt=Date.now();
const shortcutManager=createShortcutManager({read:()=>readJSON(path.join(root,'ui-settings.json'),{}),write:doc=>atomicJSON(path.join(root,'ui-settings.json'),doc),register:(key,callback)=>globalShortcut.register(key,callback),unregister:key=>globalShortcut.unregister(key),onTrigger:()=>toggleMain(),inactive:smoke});
const zh=()=>resolveLanguage(languagePreference())==='zh';
const label=(a,b)=>zh()?a:b;
app.on('second-instance',(_event,argv)=>{if(argv.includes('--quit'))app.quit();else if(!argv.includes('--background'))showMain();});
app.on('before-quit',()=>{quitting=true;clearTimeout(timer);});
app.on('window-all-closed',()=>{});
app.on('activate',()=>showMain());
async function api(action,params={}){
  if(demo){
    if(action==='state')return structuredClone(demoState);
    if(action==='statistics')return structuredClone(demoStatistics);
    if(action==='quota-refresh')return structuredClone(demoState.quota);
    if(action==='policy'){const t=demoState.threads.find(t=>t.id===params.id);if(t){t.policy={...params.policy,enabled:true,revision:(t.policy?.revision||0)+1};t.phase='saved';}return {ok:true};}
    if(action==='defaults'){Object.assign(demoState.newChatDefaults,params);return demoState.newChatDefaults;}
    if(action==='extension'){demoState.contextExtension.enabled=params.enabled;return demoState.contextExtension;}
    if(action==='preflight')return {allowed:true,code:'ready',message:'Demo'};
    return {ok:true};
  }
  const route=assertControlOperation(action);
  const connection=readJSON(path.join(root,'connection.json'));
  if(!Number.isSafeInteger(connection?.port)||connection.port<1||connection.port>65535||!/^[a-f0-9]{64}$/.test(connection.token||''))throw Error('Local service connection is unavailable');
  const response=await fetch(`http://127.0.0.1:${connection.port}${route.path}`,{method:route.method,headers:{Authorization:`Bearer ${connection.token}`},...(route.method==='POST'?{body:JSON.stringify(params)}:{}),signal:AbortSignal.timeout(action==='statistics'?60000:30000)});
  const body=await response.json();if(!response.ok)throw Error(localize(body.error||'Local service error'));return body;
}
const publish=()=>{if(!ready)return;atomicJSON(path.join(root,'ui-status.json'),{pid:process.pid,version:pkg.version,shortcut:shortcutManager.status(),menuReady:!!tray,menuWindowVisible:!!trayWindow?.isVisible(),menuOnScreen:!!trayWindow?.isVisible(),windowVisible:!!main?.isVisible(),bundleIdentifier:'io.github.codex-context-control',menuFrame:trayWindow?.getBounds()});};
async function ensureUiService(){return ensureDaemon();}
function createWindow(menu=false){
  const win=new BrowserWindow({width:menu?400:1080,height:menu?450:760,minWidth:menu?320:960,minHeight:menu?180:670,show:false,frame:!menu,resizable:!menu,skipTaskbar:menu,alwaysOnTop:menu,backgroundColor:'#181818',title:'Context Manager',icon:path.join(repo,'macos/Assets/ContextManager.png'),webPreferences:{preload:path.join(here,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.setMenuBarVisibility(false);win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',event=>event.preventDefault());
  win.webContents.on('render-process-gone',(_e,details)=>{console.error('UI process exited:',details.reason);if(!quitting)win.reload();});
  win.loadFile(path.join(here,'renderer/index.html'),{query:{mode:menu?'tray':'main'}});
  win.on('close',event=>{if(!quitting){event.preventDefault();win.hide();publish();}});
  win.on('show',publish);win.on('hide',publish);win.on('focus',()=>win.webContents.send('refresh'));
  win.on('blur',()=>{if(win===main)globalShortcut.setSuspended(false);});
  if(menu)win.on('blur',()=>{if(!menuDragging)win.hide();publish();});
  return win;
}
function showMain(id){if(!main)main=createWindow();if(main.isMinimized())main.restore();main.show();main.focus();trayWindow?.hide();if(id){if(main.webContents.isLoading())main.webContents.once('did-finish-load',()=>main.webContents.send('select-chat',id));else main.webContents.send('select-chat',id);}publish();}
function toggleMain(){if(main?.isVisible()&&!main.isMinimized()){main.hide();trayWindow?.hide();publish();}else showMain();}
function showSettings(){showMain();if(main.webContents.isLoading())main.webContents.once('did-finish-load',()=>main.webContents.send('open-settings'));else main.webContents.send('open-settings');}
function placeMenu(){
  const bounds=tray.getBounds(),cursor=screen.getCursorScreenPoint(),display=screen.getDisplayNearestPoint(bounds.width?{x:bounds.x,y:bounds.y}:cursor),area=display.workArea;
  const sections=trayState(lastState?.threads),count=sections.running.length+sections.recent.length;
  const height=Math.min(area.height-16,Math.max(360,320+Math.min(count,8)*52));
  const width=Math.min(400,area.width-16),x=Math.max(area.x+8,Math.min((bounds.width?bounds.x+Math.floor(bounds.width/2):cursor.x)-width/2,area.x+area.width-width-8));
  const anchorY=bounds.height?bounds.y:cursor.y;
  const y=anchorY>area.y+area.height/2?Math.max(area.y+8,area.y+area.height-height-8):Math.min(area.y+area.height-height-8,area.y+8);
  trayWindow.setBounds({x:Math.round(x),y:Math.round(y),width,height:Math.round(height)});
}
function toggleMenu(){if(trayWindow?.isVisible()){trayWindow.hide();return;}if(!trayWindow)trayWindow=createWindow(true);placeMenu();trayWindow.show();trayWindow.focus();publish();}
function icon(remaining,stale=false){
  const {bitmap,width,height}=quotaIconBitmap(remaining,{dark:nativeTheme.shouldUseDarkColors,stale});
  return nativeImage.createFromBitmap(bitmap,{width,height,scaleFactor:1});
}
function updateTray(){
  const {running:active}=trayState(lastState?.threads),bucket=selectedQuota(lastState?.quota,readJSON(path.join(root,'ui-settings.json'),{}).quotaPool),remaining=quotaRemaining(bucket),stale=quotaStale(lastState?.quota,serviceOnline);
  const key=(remaining==null?'unknown':Math.round(remaining))+'-'+stale+'-'+nativeTheme.shouldUseDarkColors;if(lastIcon!==key){tray.setImage(icon(remaining,stale));lastIcon=key;}
  const reset=quotaWindows(bucket).filter(window=>window.resetsAt).map(window=>new Date(window.resetsAt*1000).toLocaleString(zh()?'zh-CN':'en-US')).join(' / ');
  tray.setToolTip((`Context Manager · ${label('剩余额度','Quota remaining')} ${remaining==null?'—':Math.round(remaining)+'%'}${stale?' · '+label('待刷新','stale'):''}\n${active.length} ${label('个运行中','running')}${reset?' · '+label('重置','Reset')+' '+reset:''}`).slice(0,127));
}
function trayMenu(){return Menu.buildFromTemplate([{label:label('打开主窗口','Open main window'),click:()=>showMain()},{label:label('设置','Settings'),click:showSettings},{label:label('刷新额度','Refresh quota'),click:async()=>{try{const quota=await api('quota-refresh');lastState={...lastState,quota};updateTray();main?.webContents.send('refresh');trayWindow?.webContents.send('refresh');}catch(e){console.error(e.message);}}},{label:label('检查更新','Check for updates'),click:async()=>{try{await api('check-update');showMain();main.webContents.send('refresh');}catch(e){console.error(e.message);}}},{type:'separator'},{label:label('退出管理界面','Quit manager UI'),click:()=>app.quit()}]);}
ipcMain.handle('context-manager',async(event,action,params)=>{
  if(![main?.webContents.id,trayWindow?.webContents.id].includes(event.sender.id)||event.senderFrame!==event.sender.mainFrame)throw Error('Unknown UI sender');
  if(!params||typeof params!=='object'||Array.isArray(params)||JSON.stringify(params).length>65536)throw Error('Invalid UI request');
  if(action==='preferences')return {selection:languagePreference(),language:resolveLanguage(languagePreference()),english:JSON.parse(fs.readFileSync(path.join(repo,'src/locales/en.json'),'utf8')),version:pkg.version,demo,quotaPool:readJSON(path.join(root,'ui-settings.json'),{}).quotaPool||null,shortcut:shortcutManager.status(),integration:demo?{enabled:false,registered:false,available:false,inactive:true}:windowsIntegrationStatus()};
  if(action==='integration-set'){
    if(demo||smoke)throw Error('预览模式不修改 Codex 接入。');
    return setWindowsIntegration(params.enabled);
  }
  if(action==='open-logs'){
    if(smoke)throw Error('Opening log folders is disabled during smoke tests');
    fs.mkdirSync(integrationLogDirectory,{recursive:true});const error=await shell.openPath(integrationLogDirectory);if(error)throw Error(error);return {ok:true};
  }
  if(action==='confirm-compact'){
    if(smoke)throw Error('Compaction is disabled during smoke tests');
    const answer=await dialog.showMessageBox(BrowserWindow.fromWebContents(event.sender),{type:'question',title:label('请求 Codex 原生压缩？','Request native Codex compaction?'),message:label('请求 Codex 原生压缩？','Request native Codex compaction?'),detail:label('压缩可能使用现有模型额度。压缩结果长度无法保证，完成后需要重新测量。','Compaction may use your existing model allowance. Retained length is not guaranteed and must be measured again afterwards.'),buttons:[label('取消','Cancel'),label('请求压缩','Request compaction')],defaultId:0,cancelId:0,noLink:true});return {confirmed:answer.response===1};
  }
  if(action==='open-reference'){
    const urls={pricing:'https://openai.com/api/pricing/',caching:'https://developers.openai.com/api/docs/guides/prompt-caching#monitor-cache-performance',compaction:'https://developers.openai.com/api/docs/guides/compaction'};
    if(smoke||!Object.hasOwn(urls,params.id))throw Error('Unknown reference');await shell.openExternal(urls[params.id]);return {ok:true};
  }
  if(action==='quota-select'){
    if(typeof params.id!=='string'||!lastState?.quota?.buckets?.some(bucket=>bucket.id===params.id))throw Error('Unknown quota pool');
    const file=path.join(root,'ui-settings.json');atomicJSON(file,{...readJSON(file,{}),quotaPool:params.id});updateTray();return {id:params.id};
  }
  if(action==='shortcut-save'){if(typeof params.enabled!=='boolean')throw Error('Invalid shortcut setting');globalShortcut.setSuspended(false);const result=shortcutManager.set(params);publish();return result;}
  if(action==='shortcut-recording'){if(event.sender===main?.webContents)globalShortcut.setSuspended(params.active===true&&!smoke);return {ok:true};}
  if(action==='open-live'){
    if(!demo)return {ok:true};if(smoke)throw Error('Live mode is disabled during smoke tests');
    const env={...process.env,CONTEXT_CONTROL_HOME:liveHome};delete env.ELECTRON_RUN_AS_NODE;
    await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[...(app.isPackaged?[]:[path.join(here,'main.mjs')]),'--open-main'],{env,detached:true,windowsHide:true,stdio:'ignore'});child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});});
    shortcutManager.dispose();setTimeout(()=>app.quit(),100);return {ok:true};
  }
  if(action==='language'){if(!['auto','zh','en'].includes(params.selection))throw Error('Invalid language');atomicJSON(path.join(root,'language.json'),{selection:params.selection});main?.webContents.send('refresh');trayWindow?.webContents.send('refresh');return {ok:true};}
  if(action==='open-main'){showMain(typeof params.id==='string'?params.id:undefined);return {ok:true};}
  if(action==='hide'){BrowserWindow.fromWebContents(event.sender)?.hide();return {ok:true};}
  if(action==='interaction'){if(event.sender===trayWindow?.webContents){menuDragging=params.dragging===true;if(!menuDragging&&!trayWindow.isFocused())trayWindow.hide();}return {ok:true};}
  if(action==='quit'){app.quit();return {ok:true};}
  if(action==='open-codex'){const executable=settings().desktopExecutable;if(!executable||!fs.existsSync(executable))throw Error(label('请先安装或运行诊断以识别 Codex','Install first to discover the Codex application'));const p=spawn(executable,[],{cwd:path.dirname(executable),env:codexLaunchEnvironment(),detached:true,windowsHide:true,stdio:'ignore'});p.on('error',()=>{});p.unref();return {ok:true};}
  if(action==='diagnostics')return {version:pkg.version,platform:process.platform,arch:process.arch,serviceVersion:lastState?.version??null,loadedBridgeVersions:lastState?.bridges?.map(b=>b.version)??[],connectedBridges:lastState?.bridgeCount??0,logDirectory:integrationLogDirectory};
  const result=await api(action,params);if(action==='state'){lastState=result;serviceOnline=true;updateTray();}if(action==='quota-refresh'){lastState={...lastState,quota:result};updateTray();}return result;
});
app.whenReady().then(async()=>{ensureRoot();ready=true;
tray=new Tray(icon(null));tray.on('click',toggleMenu);tray.on('double-click',()=>showMain());tray.on('right-click',()=>tray.popUpContextMenu(trayMenu()));nativeTheme.on('updated',()=>updateTray());
if(args.includes('--quit')){app.quit();}else{
  if(!demo){try{await ensureUiService();}catch(e){console.error(e.message);}}
  main=createWindow();trayWindow=createWindow(true);
  shortcutManager.start();
  if(!args.includes('--background')&&!smoke)main.once('ready-to-show',()=>showMain());
  const refresh=async()=>{try{lastState=await api('state');serviceOnline=true;updateTray();}catch{serviceOnline=false;if(lastState){lastState={...lastState,bridgeCount:0,threads:lastState.threads.map(t=>({...t,connected:false,freshUsage:false}))};updateTray();}if(!demo&&Date.now()-lastServiceAttempt>15000){lastServiceAttempt=Date.now();try{await ensureUiService();}catch{}}}publish();if(!quitting)timer=setTimeout(refresh,main.isVisible()||trayWindow.isVisible()?2000:10000);};refresh();
  if(smoke){
    const loaded=win=>new Promise((resolve,reject)=>{if(!win.webContents.isLoading())resolve();else{win.webContents.once('did-finish-load',resolve);win.webContents.once('did-fail-load',(_e,code,message)=>reject(Error(`${code}: ${message}`)));}});
    try{
      if(args.includes('--shortcut-probe')){
        const probe='Control+Alt+Shift+F24';
        try{if(!globalShortcut.register(probe,()=>{})||!globalShortcut.isRegistered(probe))throw Error('Native shortcut registration failed');globalShortcut.setSuspended(true);if(!globalShortcut.isSuspended())throw Error('Native shortcut suspension failed');globalShortcut.setSuspended(false);}finally{globalShortcut.setSuspended(false);globalShortcut.unregister(probe);}
        if(globalShortcut.isRegistered(probe))throw Error('Native shortcut release failed');console.log('NATIVE_SHORTCUT_PROBE passed');
      }
      await Promise.all([loaded(main),loaded(trayWindow)]);await new Promise(r=>setTimeout(r,1200));const results=await Promise.all([main,trayWindow].map(w=>w.webContents.executeJavaScript('window.__contextSmoke()')));if(results.some(r=>!r.ok))throw Error(JSON.stringify(results));console.log('UI_SMOKE '+JSON.stringify(results));app.exit(0);
    }catch(e){console.error('UI_SMOKE_FAILED '+e.message);app.exit(1);}
  }
}
}).catch(error=>{console.error(error);app.exit(1);});
app.on('will-quit',()=>{shortcutManager.dispose();try{const s=readJSON(path.join(root,'ui-status.json'));if(s?.pid===process.pid)fs.unlinkSync(path.join(root,'ui-status.json'));}catch{}});
}
