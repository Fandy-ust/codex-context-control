import {openAccountDesktop} from '../src/account-processes.mjs';
import {accountQuotaViews} from '../src/core/account-quota-link.mjs';
import {openAccountBrowser} from './account-browser.mjs';
import {createResetNotifier} from './quota-reset-notifications.mjs';
import {createQuotaActivation} from '../src/quota-activation.mjs';
import {createTaskQueues} from '../src/task-queues.mjs';
import {app,BrowserWindow,Notification,Tray,Menu,ipcMain,nativeImage,nativeTheme,screen,globalShortcut,shell,dialog,clipboard} from 'electron';
import fs from 'node:fs';
import {readClipboardAttachments} from './clipboard-attachments.mjs';
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
import {createTrayController} from './tray-controller.mjs';
import {createUpdatePrompt} from './update-prompt.mjs';
import {demoQuotaAnalytics} from './quota-demo.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),repo=path.dirname(here),args=process.argv;
if(app.isPackaged)process.chdir(repo);
if(fs.existsSync(path.join(repo,'vendor/node.exe')))process.env.CONTEXT_CONTROL_NODE=path.join(repo,'vendor/node.exe');
const demo=args.includes('--demo'),smoke=args.includes('--smoke-test');
const liveHome=process.env.CONTEXT_CONTROL_LIVE_HOME||defaultRoot();
if(smoke)setTimeout(()=>{console.error('UI_SMOKE_FAILED startup timeout');app.exit(1);},60000).unref();
if(demo&&!process.env.CONTEXT_CONTROL_HOME)process.env.CONTEXT_CONTROL_HOME=path.join(os.tmpdir(),'context-manager-demo');
const {root,readJSON,atomicJSON,ensureRoot,settings}=await import('../src/paths.mjs');
const {createUpdateManager}=await import('../src/updates.mjs');
const {windowsIntegrationStatus,setWindowsIntegration,codexLaunchEnvironment}=await import('../src/windows-integration.mjs');
const {integrationLogDirectory}=await import('../src/diagnostic-log.mjs');
const {ensureDaemon}=await import('../src/service.mjs');
const {resolveLanguage,languagePreference,localize}=await import('../src/localization.mjs');
if(process.platform==='win32')app.commandLine.appendSwitch('lang',resolveLanguage(languagePreference())==='zh'?'zh-CN':'en-US');
const {demoState,demoStatistics}=await import('./demo.mjs');
const demoCloudCredentials={};
let demoLogins={profiles:[{id:'a'.repeat(32),email:'work@example.com',name:'Work',workspace:'demo-work',plan:'plus'},{id:'b'.repeat(32),email:'personal@example.com',name:'Personal',workspace:'demo-personal',plan:'plus'}],activeId:'a'.repeat(32),busy:false,restartRequired:false,job:null};
let demoCloud={deviceName:'Demo workstation',statisticsMode:'current',excludedAccounts:[],excludedSyncAccounts:[],excludedDevices:[],accounts:[{id:'a'.repeat(32),label:'work@example.com',customName:'Work',current:true},{id:'b'.repeat(32),label:'personal@example.com',current:false}],deviceList:[],enabled:false,provider:'repository',repository:'',gistId:'',intervalMinutes:15,startup:true,deviceId:'00000000000000000000000000000000',error:null,running:false};
const demoQueues=demo?createTaskQueues({quota:{state:()=>({...demoState.quota,updatedAt:Date.now()}),refresh:async()=>{}},thread:id=>demoState.threads.find(t=>t.id===id),start:async(id,task)=>{const chat=demoState.threads.find(t=>t.id===id);chat.status='active';chat.automaticTask={executionId:task.executionId,status:'running'};},interrupt:async(id)=>{const chat=demoState.threads.find(t=>t.id===id);chat.status='idle';if(chat.automaticTask)chat.automaticTask.status='interrupted';}}):null;
const demoActivation=demo?createQuotaActivation({quota:{state:()=>({...demoState.quota,updatedAt:Date.now()}),refresh:async()=>{}},probe:async()=>{}}):null;
const pkg=JSON.parse(fs.readFileSync(path.join(repo,'package.json'),'utf8'));
// The Electron package is the installed product. A separately running controller
// can be from an older checkout, so its version/cache must not drive UI prompts.
const uiUpdater=createUpdateManager({home:root,current:pkg.version,cacheFile:path.join(root,'updates-ui.json'),node:process.env.CONTEXT_CONTROL_NODE||settings().node||process.execPath});
app.setName('Context Manager');app.setAppUserModelId('io.github.codex-context-control');
app.setPath('userData',path.join(root,'ui-profile'));
if(!app.requestSingleInstanceLock()){app.quit();}else{
let main,trayWindow,quitting=false,lastState=null,serviceOnline=false,ready=false,timer,menuDragging=false,lastServiceAttempt=Date.now();
const shortcutManager=createShortcutManager({read:()=>readJSON(path.join(root,'ui-settings.json'),{}),write:doc=>atomicJSON(path.join(root,'ui-settings.json'),doc),register:(key,callback)=>globalShortcut.register(key,callback),unregister:key=>globalShortcut.unregister(key),onTrigger:()=>toggleMain(),inactive:smoke});
const trayController=createTrayController({create:image=>new Tray(image),render:({remaining,stale,dark})=>icon(remaining,stale,dark),handlers:{click:()=>toggleMenu(),'double-click':()=>showMain(),'right-click':()=>trayController.entry?.popUpContextMenu(trayMenu())}});
const resetNotifier=createResetNotifier({read:()=>readJSON(path.join(root,'quota-notification-delivery.json'),{}),save:value=>atomicJSON(path.join(root,'quota-notification-delivery.json'),value),show:([cn,en])=>{if(demo||smoke||!Notification.isSupported())return;const n=new Notification({title:'Context Manager',body:label(cn,en)});n.on('click',()=>showSettings());n.on('failed',(_event,error)=>console.error('Quota notification:',error));n.show();}});
const creditsNotifier=createResetNotifier({read:()=>readJSON(path.join(root,'credits-notification-delivery.json'),{}),save:value=>atomicJSON(path.join(root,'credits-notification-delivery.json'),value),show:([cn,en])=>{if(demo||smoke||!Notification.isSupported())return;const n=new Notification({title:'Context Manager',body:label(cn,en)});n.on('click',()=>showSettings());n.on('failed',(_event,error)=>console.error('Quota notification:',error));n.show();}});
const zh=()=>resolveLanguage(languagePreference())==='zh';
const label=(a,b)=>zh()?a:b;
const updateSettingsFile=path.join(root,'ui-settings.json');
const autoCheckUpdates=()=>readJSON(updateSettingsFile,{}).autoCheckUpdates!==false;
function setAutoCheckUpdates(enabled){atomicJSON(updateSettingsFile,{...readJSON(updateSettingsFile,{}),autoCheckUpdates:enabled});}
const refreshUpdateUI=()=>{main?.webContents.send('refresh');trayWindow?.webContents.send('refresh');};
const updatePrompt=createUpdatePrompt({currentVersion:()=>pkg.version,enabled:autoCheckUpdates,setEnabled:setAutoCheckUpdates,
  check:()=>uiUpdater.check(true),install:()=>uiUpdater.install(),changed:refreshUpdateUI,
  prompt:async update=>{
    if(demo||smoke)return 'skip';
    showMain();
    const answer=await dialog.showMessageBox(main,{type:'info',title:label('发现新版本','Update available'),message:label(`Context Manager ${update.version} 可更新`,`Context Manager ${update.version} is available`),detail:label(`当前版本 ${pkg.version}。更新将下载并安装新版本。`,`Current version: ${pkg.version}. The update will be downloaded and installed.`),buttons:[label('更新','Update'),label('本次跳过','Skip this time'),label('关闭自动检查','Disable automatic checks')],defaultId:0,cancelId:1,noLink:true});
    return ['install','skip','disable'][answer.response]??'skip';
  }
});

app.on('second-instance',(_event,argv)=>{if(argv.includes('--quit'))app.quit();else{trayController.repair();if(!argv.includes('--background'))showMain();}});
app.on('before-quit',()=>{quitting=true;clearTimeout(timer);});
app.on('window-all-closed',()=>{});
app.on('activate',()=>showMain());
let demoAccountAuto={enabled:false,busy:false,phase:'idle',message:'',lastSwitchAt:0};
const demoQueueState=()=>({...demoQueues.list(),accountSwitch:demoAccountAuto});
async function api(action,params={}){
  if(demo){
    if(action==='account-switch'){
      if(params.action==='preflight')return {blockers:[]};
      if(params.action==='rename'){demoLogins.profiles.find(p=>p.id===params.id).name=params.name;}
      if(params.action==='remove'){demoLogins.profiles=demoLogins.profiles.filter(p=>p.id!==params.id);}
      if(params.action==='switch'){demoLogins.activeId=params.id;demoLogins.job={status:'switched'};}
      if(params.action==='login'){demoLogins.profiles.push({id:'c'.repeat(32),email:'added@example.com',name:params.name||'',workspace:'demo-added',plan:'plus'});demoLogins.job={status:'completed'};}
      return structuredClone(accountQuotaViews(demoLogins,demoState.quota).login);
    }
    if(action==='cloud-sync'){
      if(params.action==='set-account-visibility'){demoCloud.accounts.find(p=>p.id===params.id).showQuota=params.visible;demoState.quota.accounts.find(a=>a.scope==='account:'+params.id).showQuota=params.visible;}
      if(params.action==='rename-account'){const p=demoCloud.accounts.find(p=>p.id===params.id);p.customName=params.name.trim();demoState.quota.accounts.find(a=>a.scope==='account:'+p.id).label=p.customName||p.label;}
      if(params.action==='delete-account'){demoCloud.accounts=demoCloud.accounts.filter(p=>p.id!==params.id);demoState.quota.accounts=demoState.quota.accounts.filter(p=>p.scope!=='account:'+params.id);}
      if(params.action==='credential')return {value:demoCloudCredentials[params.field]||''};if(['configure','save-and-sync'].includes(params.action)){const {token,key,action,claimLegacy,...value}=params;if(token)demoCloudCredentials.token=token;if(key)demoCloudCredentials.key=key;demoCloud={...demoCloud,...value,hasToken:!!token||demoCloud.hasToken,hasKey:!!key||demoCloud.hasKey};}if(params.action==='create-gist')demoCloud.gistId='a'.repeat(32);if(['sync','save-and-sync'].includes(params.action)){demoCloud.enabled=true;demoCloud.lastSuccess=Date.now();demoCloud.devices=5;}return structuredClone(demoCloud);}
    if(action==='state')return structuredClone({...demoState,quota:accountQuotaViews(demoLogins,demoState.quota).quota,quotaActivation:demoActivation.state(),taskQueues:demoQueueState()});
    if(action==='quota-activation')return demoActivation.command(params);
    if(action==='task-queue'){if(params.action==='account-switch')demoAccountAuto={...demoAccountAuto,enabled:params.enabled};else demoQueues.command(params);return demoQueueState();}
    if(action==='statistics')return structuredClone({...demoStatistics,threadId:params.id});
    if(action==='quota-refresh')return structuredClone(demoState.quota);
    if(action==='quota-analytics')return demoQuotaAnalytics(params);
    if(action==='policy'){const t=demoState.threads.find(t=>t.id===params.id);if(t){t.policy={...params.policy,enabled:true,revision:(t.policy?.revision||0)+1};t.phase='saved';}return {ok:true};}
    if(action==='defaults'){Object.assign(demoState.newChatDefaults,params);return demoState.newChatDefaults;}
    if(action==='extension'){demoState.contextExtension.enabled=params.enabled;return demoState.contextExtension;}
    if(action==='preflight')return {allowed:true,code:'ready',message:'Demo'};
    return {ok:true};
  }
  const route=assertControlOperation(action);
  const connection=readJSON(path.join(root,'connection.json'));
  if(!Number.isSafeInteger(connection?.port)||connection.port<1||connection.port>65535||!/^[a-f0-9]{64}$/.test(connection.token||''))throw Error('Local service connection is unavailable');
  const response=await fetch(`http://127.0.0.1:${connection.port}${route.path}`,{method:route.method,headers:{Authorization:`Bearer ${connection.token}`},...(route.method==='POST'?{body:JSON.stringify(params)}:{}),signal:AbortSignal.timeout(['statistics','quota-analytics'].includes(action)?60000:30000)});
  const body=await response.json();if(!response.ok)throw Error(localize(body.error||'Local service error'));
  if(action==='state'){body.update=uiUpdater.status();creditsNotifier.observe(body.quotaActivation?.creditsProtection?.event,{enabled:body.quotaActivation?.config?.creditsNotificationsEnabled!==false,stale:body.quota?.stale!==false});resetNotifier.observe(body.quota?.resetNotification,{enabled:body.quotaActivation?.config?.notificationsEnabled!==false,stale:body.quota?.stale!==false});}
  return body;
}
const publish=()=>{if(!ready)return;atomicJSON(path.join(root,'ui-status.json'),{pid:process.pid,version:pkg.version,shortcut:shortcutManager.status(),menuReady:trayController.ready,menuImageReady:trayController.ready,menuVisibilityEvidence:'unverified',menuWindowVisible:!!(trayWindow&&!trayWindow.isDestroyed()&&trayWindow.isVisible()),menuOnScreen:null,windowVisible:!!(main&&!main.isDestroyed()&&main.isVisible()),bundleIdentifier:'io.github.codex-context-control',menuFrame:trayWindow&&!trayWindow.isDestroyed()?trayWindow.getBounds():undefined});};
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
function toggleMain(){if(main?.isVisible()&&!main.isMinimized()&&main.isFocused()){main.hide();trayWindow?.hide();publish();}else showMain();}
function showSettings(){showMain();if(main.webContents.isLoading())main.webContents.once('did-finish-load',()=>main.webContents.send('open-settings'));else main.webContents.send('open-settings');}
function placeMenu(){
  const bounds=trayController.entry.getBounds(),cursor=screen.getCursorScreenPoint(),display=screen.getDisplayNearestPoint(bounds.width?{x:bounds.x,y:bounds.y}:cursor),area=display.workArea;
  const sections=trayState(lastState?.threads),count=sections.running.length+sections.recent.length;
  const height=Math.min(area.height-16,Math.max(360,320+Math.min(count,8)*52));
  const width=Math.min(400,area.width-16),x=Math.max(area.x+8,Math.min((bounds.width?bounds.x+Math.floor(bounds.width/2):cursor.x)-width/2,area.x+area.width-width-8));
  const anchorY=bounds.height?bounds.y:cursor.y;
  const y=anchorY>area.y+area.height/2?Math.max(area.y+8,area.y+area.height-height-8):Math.min(area.y+area.height-height-8,area.y+8);
  trayWindow.setBounds({x:Math.round(x),y:Math.round(y),width,height:Math.round(height)});
}
function toggleMenu(){if(trayWindow?.isVisible()){trayWindow.hide();return;}if(!trayWindow)trayWindow=createWindow(true);placeMenu();trayWindow.show();trayWindow.focus();publish();}
function icon(remaining,stale=false,dark=nativeTheme.shouldUseDarkColors){
  const {bitmap,width,height}=quotaIconBitmap(remaining,{dark,stale});
  return nativeImage.createFromBitmap(bitmap,{width,height,scaleFactor:1});
}
function updateTray(){
  const {running:active}=trayState(lastState?.threads),bucket=selectedQuota(lastState?.quota,readJSON(path.join(root,'ui-settings.json'),{}).quotaPool),remaining=quotaRemaining(bucket),stale=quotaStale(lastState?.quota,serviceOnline);
  const reset=quotaWindows(bucket).filter(window=>window.resetsAt).map(window=>new Date(window.resetsAt*1000).toLocaleString(zh()?'zh-CN':'en-US')).join(' / ');
  trayController.update({remaining,stale,dark:nativeTheme.shouldUseDarkColors,tooltip:(`Context Manager · ${label('剩余额度','Quota remaining')} ${remaining==null?'—':Math.round(remaining)+'%'}${stale?' · '+label('待刷新','stale'):''}\n${active.length} ${label('个运行中','running')}${reset?' · '+label('重置','Reset')+' '+reset:''}`).slice(0,127)});
}
function trayMenu(){return Menu.buildFromTemplate([{label:label('打开主窗口','Open main window'),click:()=>showMain()},{label:label('设置','Settings'),click:showSettings},{label:label('刷新额度','Refresh quota'),click:async()=>{try{const quota=await api('quota-refresh');lastState={...lastState,quota};updateTray();main?.webContents.send('refresh');trayWindow?.webContents.send('refresh');}catch(e){console.error(e.message);}}},{label:label('检查更新','Check for updates'),click:async()=>{try{showSettings();await updatePrompt.run();refreshUpdateUI();}catch(e){console.error(e.message);}}},{type:'separator'},{label:label('退出管理界面','Quit manager UI'),click:()=>app.quit()}]);}
ipcMain.handle('context-manager',async(event,action,params)=>{
  if(![main?.webContents.id,trayWindow?.webContents.id].includes(event.sender.id)||event.senderFrame!==event.sender.mainFrame)throw Error('Unknown UI sender');
  if(!params||typeof params!=='object'||Array.isArray(params)||JSON.stringify(params).length>65536)throw Error('Invalid UI request');
  if(action==='account-switch'){
    if(params.action==='login-link')throw Error('Unknown UI request');
    if(params.action==='copy-login-link'){const result=await api(action,{action:'login-link'}),url=new URL(result.authUrl);if(url.protocol!=='https:'||!['auth.openai.com','chatgpt.com'].includes(url.hostname)||url.username||url.password)throw Error('Invalid sign-in URL');if(!smoke)clipboard.writeText(result.authUrl);return {ok:true};}
    const result=await api(action,params);
    if(params.action==='login'&&result.authUrl){try{if(params.browser==='embedded')openAccountBrowser(result.authUrl,main);else if(!smoke)await shell.openExternal(result.authUrl);}catch{result.openError=label('无法打开浏览器，请复制授权链接后手动打开','Could not open browser; copy the sign-in link and open it manually');}}
    const {authUrl,...publicResult}=result;return publicResult;
  }
  if(['confirm-account-switch','confirm-login-remove'].includes(action)){
    if(smoke&&demo)return {confirmed:true};
    const switching=action==='confirm-account-switch';
    const blockers=switching?(await api('account-switch',{action:'preflight'})).blockers||[]:[],force=blockers.length>0;
    const detail=switching?(force?label(blockers.join('；')+'。强制停止将暂停所有队列并关闭 Codex 和 CLI 会话，中断运行中的任务，然后切换账号。','Force stop will pause all queues, close Codex and CLI sessions, interrupt running work, then switch accounts.'):label('将切换账号并重新打开 Codex，保留聊天历史。','Switch accounts and reopen Codex, preserving chat history.')):label('不会退出当前账号，也不会删除该账号的统计数据。','This does not sign out the active account or delete its statistics.');
    const answer=await dialog.showMessageBox(BrowserWindow.fromWebContents(event.sender),{type:force?'warning':'question',title:label(switching?'切换账号':'移除保存的登录',switching?'Switch account':'Remove saved sign-in'),message:label(switching?`切换到 ${typeof params.name==='string'?params.name.slice(0,160):'所选账号'} 并重新打开 Codex？`:'从本机保险库移除此登录？',switching?`Switch to ${typeof params.name==='string'?params.name.slice(0,160):'the selected account'} and reopen Codex?`:'Remove this sign-in from the local vault?'),detail,buttons:[label('取消','Cancel'),label(switching?(force?'强制停止并切换':'切换'):'移除',switching?(force?'Force stop and switch':'Switch'):'Remove')],defaultId:0,cancelId:0,noLink:true});return {confirmed:answer.response===1,force:answer.response===1&&force};
  }
  if(action==='cloud-sync'&&params.action==='credential')throw Error('Use the credential copy action');
  if(action==='cloud-copy-credential'){
    if(!['token','key'].includes(params.field))throw Error('Invalid sync credential field');
    const value=typeof params.value==='string'&&params.value ? params.value:(await api('cloud-sync',{action:'credential',field:params.field})).value;
    if(typeof value!=='string'||!value||value.length>512)throw Error(label('尚未保存此凭据','No saved credential'));
    if(!smoke)clipboard.writeText(value);return {ok:true,field:params.field};
  }
  if(action==='queue-image-preview'){
    const file=params.path;if(typeof file!=='string'||!path.isAbsolute(file)||!/\.(png|jpe?g|webp|gif|bmp)$/i.test(file))return {preview:null};
    try{const stat=fs.statSync(file);if(!stat.isFile()||stat.size>32*1024*1024)return {preview:null};const image=nativeImage.createFromPath(file);if(image.isEmpty())return {preview:null};const size=image.getSize(),scale=Math.min(160/size.width,120/size.height,1);return {preview:image.resize({width:Math.max(1,Math.round(size.width*scale)),height:Math.max(1,Math.round(size.height*scale))}).toDataURL()};}catch{return {preview:null};}
  }
  if(action==='queue-paste-image'){
    const source=smoke?{read:async()=>[{types:['image/png'],getType:async()=>new Blob([nativeImage.createFromBitmap(Buffer.from([245,170,90,255]),{width:1,height:1}).toPNG()],{type:'image/png'})}]}:clipboard;
    return readClipboardAttachments({clipboard:source,nativeImage,directory:path.join(root,'queue-attachments')});
  }
  if(action==='queue-pick-files'){
    const images=params.kind==='image';const result=await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender),{title:label(images?'插入图片':'插入文件',images?'Insert images':'Insert files'),properties:['openFile','multiSelections'],...(images?{filters:[{name:'Images',extensions:['png','jpg','jpeg','webp','gif','bmp']}]}:{})});
    return {attachments:result.canceled?[]:result.filePaths.slice(0,20).map(file=>({path:file,name:path.basename(file),kind:/\.(png|jpe?g|webp|gif|bmp)$/i.test(file)?'image':'file'}))};
  }
  if(action==='preferences')return {selection:languagePreference(),language:resolveLanguage(languagePreference()),english:JSON.parse(fs.readFileSync(path.join(repo,'src/locales/en.json'),'utf8')),version:pkg.version,demo,autoCheckUpdates:autoCheckUpdates(),quotaPool:readJSON(path.join(root,'ui-settings.json'),{}).quotaPool||null,shortcut:shortcutManager.status(),integration:demo?{enabled:false,registered:false,available:false,inactive:true}:windowsIntegrationStatus()};
  if(action==='update-preferences'){if(typeof params.enabled!=='boolean')throw Error('Invalid update preference');setAutoCheckUpdates(params.enabled);refreshUpdateUI();return {enabled:autoCheckUpdates()};}
  if(action==='check-update'){const result=await updatePrompt.run();refreshUpdateUI();return result;}
  if(action==='integration-set'){
    if(demo||smoke)throw Error('预览模式不修改 Codex 接入。');
    return setWindowsIntegration(params.enabled);
  }
  if(action==='open-logs'){
    if(smoke)throw Error('Opening log folders is disabled during smoke tests');
    fs.mkdirSync(integrationLogDirectory,{recursive:true});const error=await shell.openPath(integrationLogDirectory);if(error)throw Error(error);return {ok:true};
  }
  if(action==='confirm-account-delete'){
    const answer=await dialog.showMessageBox(BrowserWindow.fromWebContents(event.sender),{type:'warning',title:label('删除账号及统计','Delete account and statistics'),message:label('删除该账号的本机记录和全部本机统计？','Delete this account and all its statistics on this device?'),detail:label('清除账号缓存、额度历史、Token 与费用统计和已下载的同步统计，无法撤销。不会退出 Codex，也不会删除其他设备或云端原始数据。当前账号会在再次检测后重新出现并记录新数据。','Clears cached quota, quota history, token and cost statistics, and downloaded sync statistics. This cannot be undone. Codex stays signed in; source data on other devices and in the cloud remains. The signed-in account will be detected again and collect new data.'),buttons:[label('取消','Cancel'),label('删除账号及统计','Delete account and statistics')],defaultId:0,cancelId:0,noLink:true});return {confirmed:answer.response===1};
  }
  if(action==='confirm-compact'){
    if(smoke)throw Error('Compaction is disabled during smoke tests');
    const answer=await dialog.showMessageBox(BrowserWindow.fromWebContents(event.sender),{type:'question',title:label('请求 Codex 原生压缩？','Request native Codex compaction?'),message:label('请求 Codex 原生压缩？','Request native Codex compaction?'),detail:label('压缩可能使用现有模型额度。压缩结果长度无法保证，完成后需要重新测量。','Compaction may use your existing model allowance. Retained length is not guaranteed and must be measured again afterwards.'),buttons:[label('取消','Cancel'),label('请求压缩','Request compaction')],defaultId:0,cancelId:0,noLink:true});return {confirmed:answer.response===1};
  }
  if(action==='open-reference'){
    const urls={'cloud-sync':'https://github.com/Fandy-ust/codex-context-control/blob/main/docs/CLOUD_SYNC.md',pricing:'https://openai.com/api/pricing/',caching:'https://developers.openai.com/api/docs/guides/prompt-caching#monitor-cache-performance',compaction:'https://developers.openai.com/api/docs/guides/compaction'};
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
  if(action==='open-codex'){await openAccountDesktop({environment:codexLaunchEnvironment()});return {ok:true};}
  if(action==='diagnostics')return {version:pkg.version,platform:process.platform,arch:process.arch,serviceVersion:lastState?.version??null,loadedBridgeVersions:lastState?.bridges?.map(b=>b.version)??[],connectedBridges:lastState?.bridgeCount??0,logDirectory:integrationLogDirectory};
  const result=await api(action,params);if(action==='state'){lastState=result;serviceOnline=true;updateTray();}if(action==='quota-refresh'){lastState={...lastState,quota:result};updateTray();}return result;
});
app.whenReady().then(async()=>{ensureRoot();ready=true;
  if(process.platform==='win32'&&app.isPackaged&&!demo&&!smoke){
    // Windows associates toast permissions and delivery with the Start-menu ID.
    const shortcut=path.join(app.getPath('appData'),'Microsoft/Windows/Start Menu/Programs/Context Manager/Context Manager.lnk');
    if(fs.existsSync(shortcut))try{shell.writeShortcutLink(shortcut,'update',{target:process.execPath,appUserModelId:'io.github.codex-context-control'});}catch(error){console.error('Notification shortcut:',error.message);}
  }
trayController.start();updateTray();nativeTheme.on('updated',updateTray);
if(args.includes('--quit')){app.quit();}else{
  if(!demo){try{await ensureUiService();}catch(e){console.error(e.message);}}
  // A Dock/shortcut launch can create the main window while ensureUiService awaits.
  // Reuse it: replacing the reference leaves the first window unmanaged.
  main??=createWindow();trayWindow??=createWindow(true);
  shortcutManager.start();
  if(!args.includes('--background')&&!smoke){if(main.webContents.isLoading())main.once('ready-to-show',()=>showMain());else showMain();}
  const refresh=async()=>{try{lastState=await api('state');serviceOnline=true;updateTray();}catch{serviceOnline=false;if(lastState){lastState={...lastState,bridgeCount:0,threads:lastState.threads.map(t=>({...t,connected:false,freshUsage:false}))};}updateTray();if(!demo&&Date.now()-lastServiceAttempt>15000){lastServiceAttempt=Date.now();try{await ensureUiService();}catch{}}}publish();if(!quitting&&!main.isDestroyed()&&!trayWindow.isDestroyed())timer=setTimeout(refresh,main.isVisible()||trayWindow.isVisible()?2000:10000);};refresh();
  if(!demo&&!smoke)main.webContents.once('did-finish-load',()=>{updatePrompt.run(true).then(refreshUpdateUI).catch(error=>console.error('Startup update check:',error.message));});
  if(smoke){
    if(process.platform==='win32'){
      const expected=resolveLanguage(languagePreference())==='zh'?'zh-CN':'en-US';
      if(app.getLocale()!==expected)throw Error('Packaged locale mismatch: '+app.getLocale());
      console.log('CHROMIUM_LOCALE '+app.getLocale());
    }
    const loaded=win=>new Promise((resolve,reject)=>{if(!win.webContents.isLoading())resolve();else{win.webContents.once('did-finish-load',resolve);win.webContents.once('did-fail-load',(_e,code,message)=>reject(Error(`${code}: ${message}`)));}});
    try{
      if(args.includes('--shortcut-probe')){
        const probe='Control+Alt+Shift+F24';
        try{if(!globalShortcut.register(probe,()=>{})||!globalShortcut.isRegistered(probe))throw Error('Native shortcut registration failed');globalShortcut.setSuspended(true);if(!globalShortcut.isSuspended())throw Error('Native shortcut suspension failed');globalShortcut.setSuspended(false);}finally{globalShortcut.setSuspended(false);globalShortcut.unregister(probe);}
        if(globalShortcut.isRegistered(probe))throw Error('Native shortcut release failed');console.log('NATIVE_SHORTCUT_PROBE passed');
      }
      await Promise.all([loaded(main),loaded(trayWindow)]);await new Promise(r=>setTimeout(r,1200));if(process.env.CONTEXT_CONTROL_SMOKE_SCREENSHOT_DIR){const directory=path.resolve(process.env.CONTEXT_CONTROL_SMOKE_SCREENSHOT_DIR);fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'sidebar-quota.png'),(await main.webContents.capturePage()).toPNG());const footer=await main.webContents.executeJavaScript("(()=>{const r=document.querySelector('.sidebar-footer-row').getBoundingClientRect();return {x:8,y:Math.floor(r.top-10),width:Math.ceil(r.right),height:Math.ceil(r.height+20)}})()");fs.writeFileSync(path.join(directory,'quota-footer.png'),(await main.webContents.capturePage(footer)).toPNG());}const analyticsSmoke=await main.webContents.executeJavaScript('window.__contextQuotaSmoke({preview:true})');if(!analyticsSmoke.ok)throw Error(JSON.stringify(analyticsSmoke));main.showInactive();await new Promise(r=>setTimeout(r,250));if(process.env.CONTEXT_CONTROL_SMOKE_SCREENSHOT_DIR)fs.writeFileSync(path.join(path.resolve(process.env.CONTEXT_CONTROL_SMOKE_SCREENSHOT_DIR),'quota-analytics.png'),(await main.webContents.capturePage()).toPNG());if(process.env.CONTEXT_CONTROL_SMOKE_SCREENSHOT_DIR){
        await main.webContents.executeJavaScript(`document.querySelector('.qa-card .qa-chart').scrollIntoView({block:'center'})`);await new Promise(resolve=>setTimeout(resolve,220));
        await main.webContents.executeJavaScript(`(()=>{const svg=document.querySelector('.qa-card .qa-chart'),points=[...svg.querySelectorAll('[data-qa-point]')],p=points[Math.floor(points.length/3)],screen=new DOMPoint(+p.dataset.qaX,+svg.dataset.qaTop+35).matrixTransform(svg.getScreenCTM());svg.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:screen.x,clientY:screen.y}));})()`);
        await new Promise(resolve=>setTimeout(resolve,100));
        fs.writeFileSync(path.join(path.resolve(process.env.CONTEXT_CONTROL_SMOKE_SCREENSHOT_DIR),'quota-chart-hover.png'),(await main.webContents.capturePage()).toPNG());
        await main.webContents.executeJavaScript('window.__contextPricePreview()');await new Promise(resolve=>setTimeout(resolve,220));
        fs.writeFileSync(path.join(path.resolve(process.env.CONTEXT_CONTROL_SMOKE_SCREENSHOT_DIR),'quota-price-overlay.png'),(await main.webContents.capturePage()).toPNG());
        await main.webContents.executeJavaScript('window.__contextQuotaSmoke({preview:true})');
        await main.webContents.executeJavaScript(`document.querySelector('.qa-analysis-heading').scrollIntoView();new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
        await new Promise(resolve=>setTimeout(resolve,200));
        fs.writeFileSync(path.join(path.resolve(process.env.CONTEXT_CONTROL_SMOKE_SCREENSHOT_DIR),'quota-advanced.png'),(await main.webContents.capturePage()).toPNG());
          await main.webContents.executeJavaScript(`document.querySelector('.cost-calendar').scrollIntoView();document.querySelector('.main').scrollTop-=85;new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
          await new Promise(resolve=>setTimeout(resolve,220));
          fs.writeFileSync(path.join(path.resolve(process.env.CONTEXT_CONTROL_SMOKE_SCREENSHOT_DIR),'cost-heatmap.png'),(await main.webContents.capturePage()).toPNG());
          await main.webContents.executeJavaScript(`document.querySelector('[data-action="cost-mode"][data-mode="line"]').click();document.querySelector('.cost-calendar').scrollIntoView();document.querySelector('.main').scrollTop-=85;new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
          await new Promise(resolve=>setTimeout(resolve,220));
          await main.webContents.executeJavaScript(`(()=>{const point=document.querySelector('.cost-calendar [data-qa-point]');if(point){const r=point.getBoundingClientRect();point.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:r.x,clientY:r.y}));}})()`);
          await new Promise(resolve=>setTimeout(resolve,100));
          fs.writeFileSync(path.join(path.resolve(process.env.CONTEXT_CONTROL_SMOKE_SCREENSHOT_DIR),'cost-line.png'),(await main.webContents.capturePage()).toPNG());
          await main.webContents.executeJavaScript(`document.querySelector('[data-action="cost-mode"][data-mode="heatmap"]').click()`);
          await main.webContents.executeJavaScript(`document.querySelector('[data-action="qa-mode"][data-mode="simple"]').click();document.querySelector('.qa-analysis-heading').scrollIntoView();new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
          await new Promise(resolve=>setTimeout(resolve,220));
          fs.writeFileSync(path.join(path.resolve(process.env.CONTEXT_CONTROL_SMOKE_SCREENSHOT_DIR),'quota-simple.png'),(await main.webContents.capturePage()).toPNG());
          await main.webContents.executeJavaScript(`document.querySelector('[data-action="qa-mode"][data-mode="advanced"]').click();document.querySelector('[data-qa-chart="weekly-scatter"]').scrollIntoView();new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
          await new Promise(resolve=>setTimeout(resolve,220));
          fs.writeFileSync(path.join(path.resolve(process.env.CONTEXT_CONTROL_SMOKE_SCREENSHOT_DIR),'quota-statistics.png'),(await main.webContents.capturePage()).toPNG());
      }
      await main.webContents.executeJavaScript('window.__contextQuotaSmoke()');console.log('QUOTA_ANALYTICS_SMOKE '+JSON.stringify(analyticsSmoke));const cloudSmoke=await main.webContents.executeJavaScript('window.__contextCloudSmoke()');if(!cloudSmoke.ok)throw Error(JSON.stringify(cloudSmoke));console.log('CLOUD_SYNC_SMOKE '+JSON.stringify(cloudSmoke));const accountsSmoke=await main.webContents.executeJavaScript('window.__contextAccountsSmoke()');if(!accountsSmoke.ok)throw Error(JSON.stringify(accountsSmoke));console.log('ACCOUNT_MANAGEMENT_SMOKE '+JSON.stringify(accountsSmoke));const loginSmoke=await main.webContents.executeJavaScript('window.__contextLoginSmoke({preview:true})');if(!loginSmoke.ok)throw Error(JSON.stringify(loginSmoke));console.log('ACCOUNT_SWITCH_SMOKE '+JSON.stringify(loginSmoke));if(process.env.CONTEXT_CONTROL_SMOKE_SCREENSHOT_DIR)fs.writeFileSync(path.join(path.resolve(process.env.CONTEXT_CONTROL_SMOKE_SCREENSHOT_DIR),'account-switch-0.27.0.png'),(await main.webContents.capturePage()).toPNG());await main.webContents.executeJavaScript("document.querySelector('.settings-close').click()");if(process.env.CONTEXT_CONTROL_SMOKE_SCREENSHOT_DIR){main.showInactive();await new Promise(r=>setTimeout(r,100));fs.writeFileSync(path.join(path.resolve(process.env.CONTEXT_CONTROL_SMOKE_SCREENSHOT_DIR),'multi-account-sidebar.png'),(await main.webContents.capturePage()).toPNG());await main.webContents.executeJavaScript('window.__contextAccountsPreview()');await new Promise(r=>setTimeout(r,100));fs.writeFileSync(path.join(path.resolve(process.env.CONTEXT_CONTROL_SMOKE_SCREENSHOT_DIR),'account-management.png'),(await main.webContents.capturePage()).toPNG());}const results=await Promise.all([main,trayWindow].map(w=>w.webContents.executeJavaScript('window.__contextSmoke()')));if(results.some(r=>!r.ok))throw Error(JSON.stringify(results));if(process.env.CONTEXT_CONTROL_SMOKE_SCREENSHOT_DIR){main.showInactive();await main.webContents.executeJavaScript('window.__contextSmoke({preview:true})');await new Promise(r=>setTimeout(r,100));fs.writeFileSync(path.join(path.resolve(process.env.CONTEXT_CONTROL_SMOKE_SCREENSHOT_DIR),'timeline-settings.png'),(await main.webContents.capturePage()).toPNG());}
      // Use native wheel input so Chromium's scroll latching is exercised.
      const sliderPoint=await main.webContents.executeJavaScript("window.__contextSliderSmoke('prepare')");
      main.webContents.sendInputEvent({type:'mouseMove',...sliderPoint});
      main.webContents.sendInputEvent({type:'mouseDown',...sliderPoint,button:'left',clickCount:1});
      await new Promise(resolve=>setTimeout(resolve,30));
      const grab=await main.webContents.executeJavaScript("window.__contextSliderSmoke('grab')");if(!grab.ok)throw Error('Maximum handle jumped or selected compression on mouse down');
      for(let i=1;i<=8;i++){main.webContents.sendInputEvent({type:'mouseMove',x:sliderPoint.x-15*i,y:sliderPoint.y,modifiers:['leftButtonDown']});await new Promise(resolve=>setTimeout(resolve,20));}
      main.webContents.sendInputEvent({type:'mouseUp',x:sliderPoint.x-120,y:sliderPoint.y,button:'left',clickCount:1});
      await new Promise(resolve=>setTimeout(resolve,30));
      const sliderResult=await main.webContents.executeJavaScript("window.__contextSliderSmoke('result')");if(!sliderResult.ok)throw Error(JSON.stringify(sliderResult));console.log('SLIDER_ENDPOINT_SMOKE '+JSON.stringify(sliderResult));
      const point=await main.webContents.executeJavaScript("window.__contextScrollSmoke('prepare')");
      for(let i=0;i<24;i++){
        main.webContents.sendInputEvent({type:'mouseMove',...point});
        main.webContents.sendInputEvent({type:'mouseWheel',...point,deltaY:i<12?-45:45,deltaX:0,canScroll:true});
        await new Promise(r=>setTimeout(r,25));
        const sample=await main.webContents.executeJavaScript("window.__contextScrollSmoke('check')");
        if(!sample.active||!sample.stable)throw Error('Wheel gesture replaced its active scroll container: '+JSON.stringify(sample));
      }
      const scrollResult=await main.webContents.executeJavaScript("window.__contextScrollSmoke('result')");
      if(!scrollResult.ok)throw Error(JSON.stringify(scrollResult));
      console.log('TIMELINE_SCROLL_SMOKE '+JSON.stringify(scrollResult));
      await new Promise(r=>setTimeout(r,250));
      const queueSmoke=await main.webContents.executeJavaScript('window.__contextQueueSmoke()');if(!queueSmoke.ok)throw Error(JSON.stringify(queueSmoke));console.log('TASK_QUEUE_SMOKE '+JSON.stringify(queueSmoke));
      if(process.env.CONTEXT_CONTROL_SMOKE_SCREENSHOT_DIR)fs.writeFileSync(path.join(path.resolve(process.env.CONTEXT_CONTROL_SMOKE_SCREENSHOT_DIR),'task-queue.png'),(await main.webContents.capturePage()).toPNG());
      if(process.env.CONTEXT_CONTROL_SMOKE_SCREENSHOT_DIR)for(const [tab,name]of [[null,'task-queue'],['prompt','task-editor'],['quota','task-quota']]){
        await main.webContents.executeJavaScript(`window.__contextQueuePreview(${JSON.stringify(tab)})`);await new Promise(resolve=>setTimeout(resolve,100));
        fs.writeFileSync(path.join(path.resolve(process.env.CONTEXT_CONTROL_SMOKE_SCREENSHOT_DIR),name+'.png'),(await main.webContents.capturePage()).toPNG());
      }
      const composerSmoke=await main.webContents.executeJavaScript('window.__contextComposerSmoke()');if(!composerSmoke.ok)throw Error(JSON.stringify(composerSmoke));console.log('TASK_COMPOSER_SMOKE '+JSON.stringify(composerSmoke));if(process.env.CONTEXT_CONTROL_SMOKE_SCREENSHOT_DIR){for(const kind of ['base','model','full','attachments']){await main.webContents.executeJavaScript(`window.__contextComposerPreview('${kind}')`);await new Promise(r=>setTimeout(r,180));fs.writeFileSync(path.join(path.resolve(process.env.CONTEXT_CONTROL_SMOKE_SCREENSHOT_DIR),'composer-'+kind+'-0.22.5.png'),(await main.webContents.capturePage()).toPNG());}}
      const activationSmoke=await main.webContents.executeJavaScript('window.__contextActivationSmoke()');if(!activationSmoke.ok)throw Error(JSON.stringify(activationSmoke));console.log('QUOTA_ACTIVATION_SMOKE '+JSON.stringify(activationSmoke));
      if(process.env.CONTEXT_CONTROL_SMOKE_SCREENSHOT_DIR)fs.writeFileSync(path.join(path.resolve(process.env.CONTEXT_CONTROL_SMOKE_SCREENSHOT_DIR),'quota-activation.png'),(await main.webContents.capturePage()).toPNG());
      const appearance=await main.webContents.executeJavaScript('window.__contextAppearanceSmoke()');if(!appearance.ok)throw Error(JSON.stringify(appearance));console.log('APPEARANCE_SMOKE '+JSON.stringify(appearance));
      if(process.env.CONTEXT_CONTROL_SMOKE_SCREENSHOT_DIR){main.showInactive();await new Promise(r=>setTimeout(r,120));fs.writeFileSync(path.join(path.resolve(process.env.CONTEXT_CONTROL_SMOKE_SCREENSHOT_DIR),'scroll-edges-and-events.png'),(await main.webContents.capturePage()).toPNG());}
      // Exercise the real window state: visible in the background must focus in one press.
      const waitFor=async check=>{const end=Date.now()+3000;while(!check()&&Date.now()<end)await new Promise(r=>setTimeout(r,25));if(!check())throw Error('Shortcut window focus transition timed out');};
      const covering=new BrowserWindow({width:320,height:240,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
      try{
        showMain();await waitFor(()=>main.isFocused());
        covering.show();covering.focus();await waitFor(()=>covering.isFocused()&&!main.isFocused());
        toggleMain();await waitFor(()=>main.isVisible()&&main.isFocused());
        toggleMain();await waitFor(()=>!main.isVisible());
        toggleMain();await waitFor(()=>main.isVisible()&&main.isFocused());
        main.minimize();await waitFor(()=>main.isMinimized());
        toggleMain();await waitFor(()=>!main.isMinimized()&&main.isVisible()&&main.isFocused());
      }finally{main.hide();covering.destroy();}
      // Drain focus-triggered renderer refreshes before destroying the app windows.
      await new Promise(resolve=>setTimeout(resolve,200));
      console.log('SHORTCUT_FOCUS_SMOKE passed');console.log('UI_SMOKE '+JSON.stringify(results));app.exit(0);
    }catch(e){console.error('UI_SMOKE_FAILED '+e.message);app.exit(1);}
  }
}
}).catch(error=>{console.error(error);app.exit(1);});
app.on('will-quit',()=>{trayController.stop();nativeTheme.removeListener('updated',updateTray);shortcutManager.dispose();try{const s=readJSON(path.join(root,'ui-status.json'));if(s?.pid===process.pid)fs.unlinkSync(path.join(root,'ui-status.json'));}catch{}});
}
