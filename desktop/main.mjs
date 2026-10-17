import {app,BrowserWindow,Tray,Menu,ipcMain,nativeImage,nativeTheme,screen,globalShortcut} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {trayState} from '../src/tray-state.mjs';
import {defaultRoot} from '../src/platform/index.mjs';
import {createShortcutManager} from '../src/ui-shortcut.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),repo=path.dirname(here),args=process.argv;
if(fs.existsSync(path.join(repo,'vendor/node.exe')))process.env.CONTEXT_CONTROL_NODE=path.join(repo,'vendor/node.exe');
const demo=args.includes('--demo'),smoke=args.includes('--smoke-test');
const liveHome=process.env.CONTEXT_CONTROL_LIVE_HOME||defaultRoot();
if(smoke)setTimeout(()=>{console.error('UI_SMOKE_FAILED startup timeout');app.exit(1);},30000).unref();
if(demo&&!process.env.CONTEXT_CONTROL_HOME)process.env.CONTEXT_CONTROL_HOME=path.join(os.tmpdir(),'context-manager-demo');
const {root,readJSON,atomicJSON,ensureRoot,settings}=await import('../src/paths.mjs');
const {ensureDaemon}=await import('../src/service.mjs');
const {resolveLanguage,languagePreference,localize}=await import('../src/localization.mjs');
const {demoState,demoStatistics}=await import('./demo.mjs');
const pkg=JSON.parse(fs.readFileSync(path.join(repo,'package.json'),'utf8'));
app.setName('Context Manager');app.setAppUserModelId('io.github.codex-context-control');
app.setPath('userData',path.join(root,'ui-profile'));
if(!app.requestSingleInstanceLock()){app.quit();}else{
let main,trayWindow,tray,quitting=false,lastState=null,ready=false,timer,lastIcon='',menuDragging=false,lastServiceAttempt=Date.now();
const shortcutManager=createShortcutManager({read:()=>readJSON(path.join(root,'ui-settings.json'),{}),write:doc=>atomicJSON(path.join(root,'ui-settings.json'),doc),register:(key,callback)=>globalShortcut.register(key,callback),unregister:key=>globalShortcut.unregister(key),onTrigger:()=>showMain(),inactive:smoke});
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
    if(action==='policy'){const t=demoState.threads.find(t=>t.id===params.id);if(t){t.policy={...params.policy,enabled:true,revision:(t.policy?.revision||0)+1};t.phase='saved';}return {ok:true};}
    if(action==='defaults'){Object.assign(demoState.newChatDefaults,params);return demoState.newChatDefaults;}
    if(action==='extension'){demoState.contextExtension.enabled=params.enabled;return demoState.contextExtension;}
    if(action==='preflight')return {allowed:true,code:'ready',message:'Demo'};
    return {ok:true};
  }
  const routes={state:['GET','/state'],statistics:['POST','/context-stats'],preflight:['POST','/preflight'],policy:['POST','/policy'],clear:['POST','/clear'],compact:['POST','/compact'],defaults:['POST','/new-chat-defaults'],extension:['POST','/context-extension'],scan:['POST','/scan'],'check-update':['POST','/updates/check'],'install-update':['POST','/updates/install']};
  const route=routes[action];if(!route)throw Error('Unknown action');
  const connection=readJSON(path.join(root,'connection.json'));
  if(!Number.isSafeInteger(connection?.port)||connection.port<1||connection.port>65535||!/^[a-f0-9]{64}$/.test(connection.token||''))throw Error('Local service connection is unavailable');
  const response=await fetch(`http://127.0.0.1:${connection.port}${route[1]}`,{method:route[0],headers:{Authorization:`Bearer ${connection.token}`},...(route[0]==='POST'?{body:JSON.stringify(params)}:{}),signal:AbortSignal.timeout(action==='statistics'?60000:30000)});
  const body=await response.json();if(!response.ok)throw Error(localize(body.error||'Local service error'));return body;
}
const publish=()=>{if(!ready)return;atomicJSON(path.join(root,'ui-status.json'),{pid:process.pid,version:pkg.version,shortcut:shortcutManager.status(),menuReady:!!tray,menuWindowVisible:!!trayWindow?.isVisible(),menuOnScreen:!!trayWindow?.isVisible(),windowVisible:!!main?.isVisible(),bundleIdentifier:'io.github.codex-context-control',menuFrame:trayWindow?.getBounds()});};
async function ensureUiService(){try{if((await api('state')).version===pkg.version)return;}catch{}await ensureDaemon();}
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
function showSettings(){showMain();if(main.webContents.isLoading())main.webContents.once('did-finish-load',()=>main.webContents.send('open-settings'));else main.webContents.send('open-settings');}
function placeMenu(){
  const bounds=tray.getBounds(),cursor=screen.getCursorScreenPoint(),display=screen.getDisplayNearestPoint(bounds.width?{x:bounds.x,y:bounds.y}:cursor),area=display.workArea;
  const sections=trayState(lastState?.threads),count=sections.running.length+sections.recent.length;
  const height=Math.min(area.height-16,Math.max(220,175+Math.min(count,10)*52));
  const width=Math.min(400,area.width-16),x=Math.max(area.x+8,Math.min((bounds.width?bounds.x+Math.floor(bounds.width/2):cursor.x)-width/2,area.x+area.width-width-8));
  const anchorY=bounds.height?bounds.y:cursor.y;
  const y=anchorY>area.y+area.height/2?Math.max(area.y+8,area.y+area.height-height-8):Math.min(area.y+area.height-height-8,area.y+8);
  trayWindow.setBounds({x:Math.round(x),y:Math.round(y),width,height:Math.round(height)});
}
function toggleMenu(){if(trayWindow?.isVisible()){trayWindow.hide();return;}if(!trayWindow)trayWindow=createWindow(true);placeMenu();trayWindow.show();trayWindow.focus();publish();}
function icon(progress){
  // NativeImage uses a BGRA bitmap; render a crisp ring without shipping a
  // remote image or changing the application icon. Also supports dark taskbars.
  const n=32,b=Buffer.alloc(n*n*4),light=nativeTheme.shouldUseDarkColors?235:45;
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){const dx=x-15.5,dy=y-15.5,r=Math.hypot(dx,dy),angle=(Math.atan2(dy,dx)+Math.PI/2+Math.PI*2)%(Math.PI*2);let value=0,alpha=0;if(r>=12&&r<=14.4){value=progress!=null&&angle<=Math.PI*2*Math.min(1,progress)?light:light*.38;alpha=255;}if(x>=10&&x<=21&&[11,15,19].includes(y)){value=light;alpha=255;}const at=(y*n+x)*4;b[at]=b[at+1]=b[at+2]=value;b[at+3]=alpha;}
  return nativeImage.createFromBitmap(b,{width:n,height:n,scaleFactor:1});
}
function updateTray(){
  const {running:active,fraction}=trayState(lastState?.threads);
  const key=(fraction==null?'unknown':Math.round(fraction*100))+'-'+nativeTheme.shouldUseDarkColors;if(lastIcon!==key){tray.setImage(icon(fraction));lastIcon=key;}
  tray.setToolTip(`Context Manager · ${active.length} ${label('个运行中','running')}${fraction==null?'':` · ${Math.round(fraction*100)}%`}`);
}
function trayMenu(){return Menu.buildFromTemplate([{label:label('打开主窗口','Open main window'),click:()=>showMain()},{label:label('设置','Settings'),click:showSettings},{label:label('检查更新','Check for updates'),click:async()=>{try{await api('check-update');showMain();main.webContents.send('refresh');}catch(e){console.error(e.message);}}},{type:'separator'},{label:label('退出管理界面','Quit manager UI'),click:()=>app.quit()}]);}
ipcMain.handle('context-manager',async(event,action,params)=>{
  if(![main?.webContents.id,trayWindow?.webContents.id].includes(event.sender.id)||event.senderFrame!==event.sender.mainFrame)throw Error('Unknown UI sender');
  if(!params||typeof params!=='object'||Array.isArray(params)||JSON.stringify(params).length>65536)throw Error('Invalid UI request');
  if(action==='preferences')return {selection:languagePreference(),language:resolveLanguage(languagePreference()),english:JSON.parse(fs.readFileSync(path.join(repo,'src/locales/en.json'),'utf8')),version:pkg.version,demo,shortcut:shortcutManager.status()};
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
  if(action==='open-codex'){const executable=settings().desktopExecutable;if(!executable||!fs.existsSync(executable))throw Error(label('请先安装或运行诊断以识别 Codex','Install first to discover the Codex application'));const p=spawn(executable,[],{detached:true,windowsHide:true,stdio:'ignore'});p.on('error',()=>{});p.unref();return {ok:true};}
  if(action==='diagnostics')return {version:pkg.version,platform:process.platform,arch:process.arch,serviceVersion:lastState?.version??null,loadedBridgeVersions:lastState?.bridges?.map(b=>b.version)??[],connectedBridges:lastState?.bridgeCount??0};
  const result=await api(action,params);if(action==='state'){lastState=result;updateTray();}return result;
});
app.whenReady().then(async()=>{ensureRoot();ready=true;
tray=new Tray(icon(null));tray.on('click',toggleMenu);tray.on('double-click',()=>showMain());tray.on('right-click',()=>tray.popUpContextMenu(trayMenu()));nativeTheme.on('updated',()=>updateTray());
if(args.includes('--quit')){app.quit();}else{
  if(!demo){try{await ensureUiService();}catch(e){console.error(e.message);}}
  main=createWindow();trayWindow=createWindow(true);
  shortcutManager.start();
  if(!args.includes('--background')&&!smoke)main.once('ready-to-show',()=>showMain());
  const refresh=async()=>{try{lastState=await api('state');updateTray();}catch{if(lastState){lastState={...lastState,bridgeCount:0,threads:lastState.threads.map(t=>({...t,connected:false,freshUsage:false}))};updateTray();}if(!demo&&Date.now()-lastServiceAttempt>15000){lastServiceAttempt=Date.now();try{await ensureUiService();}catch{}}}publish();if(!quitting)timer=setTimeout(refresh,main.isVisible()||trayWindow.isVisible()?2000:10000);};refresh();
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
