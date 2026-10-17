const {contextBridge,ipcRenderer}=require('electron');
const actions=new Set(['state','statistics','preflight','policy','clear','compact','defaults','extension','scan','check-update','install-update','preferences','language','open-main','open-codex','hide','quit','diagnostics','interaction','open-live','shortcut-save','shortcut-recording','integration-set','open-logs','quota-refresh','quota-select']);
contextBridge.exposeInMainWorld('contextManager',Object.freeze({
  invoke:(action,params={})=>{if(!actions.has(action))return Promise.reject(Error('Unknown action'));return ipcRenderer.invoke('context-manager',action,params).catch(error=>{throw Error(error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/,''));});},
  onSelect:callback=>{const listener=(_event,id)=>callback(id);ipcRenderer.on('select-chat',listener);return ()=>ipcRenderer.removeListener('select-chat',listener);},
  onRefresh:callback=>{const listener=()=>callback();ipcRenderer.on('refresh',listener);return ()=>ipcRenderer.removeListener('refresh',listener);},
  onSettings:callback=>{const listener=()=>callback();ipcRenderer.on('open-settings',listener);return ()=>ipcRenderer.removeListener('open-settings',listener);}
}));
