import {BrowserWindow,Menu,clipboard,dialog,shell} from 'electron';
import crypto from 'node:crypto';
import {L} from '../src/localization.mjs';
import {configureAccountBrowser} from './account-browser-controls.mjs';
import {allowedLoginNavigation} from '../src/core/account-login-navigation.mjs';
export {allowedLoginNavigation};

export function openAccountBrowser(url,parent){
  if(!allowedLoginNavigation(url,url))throw Error('Invalid authorization URL');
  const window=new BrowserWindow({parent,width:620,height:800,minWidth:540,minHeight:600,title:'ChatGPT sign-in',autoHideMenuBar:false,webPreferences:{partition:'account-login-'+crypto.randomUUID(),nodeIntegration:false,contextIsolation:true,sandbox:true}});
  const children=new Set();let reporting=false;
  const openSystem=()=>shell.openExternal(url).catch(()=>{});
  const copy=()=>clipboard.writeText(url);
  const installControls=target=>target.setMenu(Menu.buildFromTemplate([{label:L('账号切换'),submenu:[
    {label:L('返回'),click:()=>{if(target.webContents.navigationHistory.canGoBack())target.webContents.navigationHistory.goBack();}},
    {label:L('重新载入'),click:()=>target.webContents.reload()},
    {label:L('复制授权链接'),click:copy},
    {label:L('使用系统浏览器'),click:openSystem}
  ]}]));
  const onProblem=async target=>{
    if(reporting||target.isDestroyed())return;reporting=true;
    try{const reply=await dialog.showMessageBox(target,{type:'info',message:L('登录页面加载失败，请重新载入或复制授权链接到其他浏览器继续。'),buttons:[L('关闭'),L('重新载入'),L('复制授权链接'),L('使用系统浏览器')],cancelId:0,defaultId:0,noLink:true});
      if(reply.response===1&&!target.isDestroyed())target.webContents.reload();else if(reply.response===2)copy();else if(reply.response===3)await openSystem();
    }catch{/* Window may close while the native dialog is being created. */}finally{reporting=false;}
  };
  installControls(window);
  configureAccountBrowser(window,url,{
    popupOptions:opener=>({parent:opener,width:620,height:800,minWidth:540,minHeight:600,autoHideMenuBar:false,webPreferences:{session:opener.webContents.session,nodeIntegration:false,contextIsolation:true,sandbox:true}}),
    onProblem:(target,issue)=>{if(issue?.kind==='frame'){if(!target.isDestroyed())target.setTitle(L('登录页面跳转或验证被拦截，请复制授权链接到其他浏览器继续。'));return;}void onProblem(target);},
    onChild:child=>{children.add(child);installControls(child);child.on('closed',()=>children.delete(child));}
  });
  window.on('closed',()=>{for(const child of children)if(!child.isDestroyed())child.destroy();children.clear();});
  window.webContents.session.setPermissionRequestHandler((_web,_permission,callback)=>callback(false));
  window.webContents.session.on('will-download',event=>event.preventDefault());
  void window.loadURL(url).catch(()=>{});return window;
}
