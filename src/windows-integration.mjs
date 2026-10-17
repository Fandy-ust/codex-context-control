import fs from 'node:fs';
import path from 'node:path';
import {root,codexHome,settings,readJSON,atomicJSON} from './paths.mjs';
import {enableWindowsStartup,disableWindowsStartup} from './platform/windows-startup.mjs';
import {probeWindowsLauncher} from './platform/windows-probe.mjs';
import {editOwnedHook} from './hooks.mjs';
import {integrationLog,integrationLogDirectory} from './diagnostic-log.mjs';

const preferenceFile=()=>path.join(root,'integration.json');
export function windowsIntegrationStatus(){
  const pref=readJSON(preferenceFile(),{}),config=settings(),registration=readJSON(path.join(root,'automatic-startup.json'));
  return {enabled:pref.enabled===true,available:config.uninstalled!==true&&!!config.shim&&fs.existsSync(config.shim),registered:pref.enabled===true&&!!config.shim&&registration?.value===config.shim&&fs.existsSync(config.shim),pendingRestart:pref.enabled===true,error:pref.lastError||null,logDirectory:integrationLogDirectory};
}
export async function setWindowsIntegration(enabled,{probe=probeWindowsLauncher,origin='user',...startupOptions}={}){
  if(typeof enabled!=='boolean')throw Error('Invalid integration preference');
  const config=settings(),hooks=path.join(codexHome,'hooks.json'),recordFile=startupOptions.recordFile||path.join(root,'automatic-startup.json');
  const previousRecord=readJSON(recordFile),previousPreference=readJSON(preferenceFile(),{}),beforeHooks=fs.existsSync(hooks)?fs.readFileSync(hooks):null;
  const command=config.shim?`"${config.shim}" --hook`:null;
  if(enabled){
    if(config.uninstalled===true||!config.shim||!fs.existsSync(config.shim))throw Error('请先安装管理器，再手动启用接入。');
    integrationLog('integration.enable_requested',{shim:config.shim,binary:config.realBinary});
    try{await probe(config.shim,config.realBinary);}catch(error){integrationLog('integration.probe_failed',{message:error.message});throw error;}
  }
  let startupChanged=false;
  try{
    if(enabled){
      enableWindowsStartup(config.shim,startupOptions);startupChanged=true;
      editOwnedHook({file:hooks,home:root,command,previousCommand:config.hookCommand});
    }else{
      disableWindowsStartup(startupOptions);startupChanged=true;
      if(config.hookCommand&&fs.existsSync(hooks))editOwnedHook({file:hooks,home:root,command:config.hookCommand,remove:true});
    }
    atomicJSON(path.join(root,'settings.json'),{...config,hookCommand:enabled?command:null});
    atomicJSON(preferenceFile(),{...previousPreference,version:Math.max(previousPreference.version||1,1),enabled,explicit:origin==='user'||previousPreference.explicit===true,lastError:null});
    integrationLog('integration.preference_saved',{enabled});
  }catch(error){
    atomicJSON(path.join(root,'settings.json'),config);
    if(beforeHooks)fs.writeFileSync(hooks,beforeHooks);else fs.rmSync(hooks,{force:true});
    if(startupChanged){try{disableWindowsStartup(startupOptions);if(previousRecord?.value)enableWindowsStartup(previousRecord.value,startupOptions);}catch{}}
    atomicJSON(preferenceFile(),previousPreference);throw error;
  }
  return windowsIntegrationStatus();
}
export function codexLaunchEnvironment(environment=process.env){
  const env={...environment},config=settings(),pref=readJSON(preferenceFile(),{});
  if(pref.enabled===true&&fs.existsSync(config.shim||''))env.CODEX_CLI_PATH=config.shim;
  else if(env.CODEX_CLI_PATH){
    const relative=path.relative(root,env.CODEX_CLI_PATH);
    if(/^bin[\\/][^\\/]+[\\/]codex-context\.exe$/i.test(relative))delete env.CODEX_CLI_PATH;
  }
  return env;
}
