import {allowedLoginNavigation} from '../src/core/account-login-navigation.mjs';

// Let Chromium create popup contexts so form POST bodies, opener references and
// the isolated cookie session survive. Never reload popup URLs in the opener.
export function configureAccountBrowser(window,authorization,{popupOptions,onProblem=()=>{},onChild=()=>{}}={}){
  const web=window.webContents;
  const source=()=>web.getURL()||authorization;
  const check=(event,target,kind='main',initiator=source())=>{
    if(allowedLoginNavigation(target,authorization,{kind,source:initiator}))return true;
    event.preventDefault();onProblem(window,{kind});return false;
  };
  web.on('will-frame-navigate',event=>check(event,event.url,event.isMainFrame?'main':'frame',event.initiator?.url||source()));
  web.on('will-navigate',(event,target)=>check(event,event.url||target));
  web.on('will-redirect',(event,target,_inPlace,isMainFrame)=>check(event,event.url||target,(event.isMainFrame??isMainFrame??true)?'main':'frame'));
  web.setWindowOpenHandler(({url})=>{
    if(!allowedLoginNavigation(url,authorization,{kind:'popup',source:source()})){onProblem(window,{kind:'popup'});return {action:'deny'};}
    return {action:'allow',overrideBrowserWindowOptions:popupOptions(window)};
  });
  web.on('did-create-window',child=>{configureAccountBrowser(child,authorization,{popupOptions,onProblem,onChild});onChild(child,window);});
  web.on('did-fail-load',(_event,code,_description,_url,isMainFrame)=>{if(code!==-3&&isMainFrame)onProblem(window);});
  web.on('render-process-gone',()=>onProblem(window));
}
