const {contextBridge,ipcRenderer,webUtils}=require('electron');
const actions=new Set(['account-switch','confirm-account-switch','confirm-login-remove','cloud-copy-credential','cloud-sync','queue-image-preview','queue-paste-image','queue-pick-files','task-queue','state','statistics','preflight','policy','clear','compact','defaults','extension','compensation','scan','check-update','install-update','preferences','update-preferences','language','open-main','open-codex','hide','quit','diagnostics','interaction','open-live','shortcut-save','shortcut-recording','integration-set','open-logs','quota-activation','quota-refresh','quota-analytics','quota-credit-baseline','quota-select','confirm-account-delete','confirm-compact','open-reference']);
contextBridge.exposeInMainWorld('contextManager',Object.freeze({
  filePath:file=>webUtils.getPathForFile(file),
  invoke:(action,params={})=>{if(!actions.has(action))return Promise.reject(Error('Unknown action'));return ipcRenderer.invoke('context-manager',action,params).catch(error=>{throw Error(error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/,''));});},
  onSelect:callback=>{const listener=(_event,id)=>callback(id);ipcRenderer.on('select-chat',listener);return ()=>ipcRenderer.removeListener('select-chat',listener);},
  onRefresh:callback=>{const listener=()=>callback();ipcRenderer.on('refresh',listener);return ()=>ipcRenderer.removeListener('refresh',listener);},
  onSettings:callback=>{const listener=()=>callback();ipcRenderer.on('open-settings',listener);return ()=>ipcRenderer.removeListener('open-settings',listener);}
}));
