import {BrowserWindow} from 'electron';
import crypto from 'node:crypto';

import {allowedLoginNavigation} from '../src/core/account-login-navigation.mjs';
export {allowedLoginNavigation};

export function openAccountBrowser(url,parent){
  if(!allowedLoginNavigation(url,url))throw Error('Invalid authorization URL');
  const window=new BrowserWindow({parent,width:560,height:780,title:'ChatGPT sign-in',autoHideMenuBar:true,webPreferences:{partition:'account-login-'+crypto.randomUUID(),nodeIntegration:false,contextIsolation:true,sandbox:true}});
  window.webContents.on('will-navigate',(event,target)=>{if(!allowedLoginNavigation(target,url))event.preventDefault();});
  window.webContents.on('will-redirect',(event,target)=>{if(!allowedLoginNavigation(target,url))event.preventDefault();});
  window.webContents.setWindowOpenHandler(({url:target})=>{if(allowedLoginNavigation(target,url))void window.loadURL(target);return {action:'deny'};});
  window.webContents.session.setPermissionRequestHandler((_web,permission,callback)=>callback(false));
  window.webContents.session.on('will-download',event=>event.preventDefault());
  void window.loadURL(url);return window;
}
