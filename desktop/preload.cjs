const {contextBridge,ipcRenderer}=require('electron');
const actions=new Set(['state','statistics','preflight','policy','clear','compact','defaults','extension','scan','check-update','install-update','preferences','language','open-main','open-codex','hide','quit','diagnostics','interaction']);
contextBridge.exposeInMainWorld('contextManager',Object.freeze({
  invoke:(action,params={})=>{if(!actions.has(action))return Promise.reject(Error('Unknown action'));return ipcRenderer.invoke('context-manager',action,params);},
  onSelect:callback=>{const listener=(_event,id)=>callback(id);ipcRenderer.on('select-chat',listener);return ()=>ipcRenderer.removeListener('select-chat',listener);},
  onRefresh:callback=>{const listener=()=>callback();ipcRenderer.on('refresh',listener);return ()=>ipcRenderer.removeListener('refresh',listener);}
}));
