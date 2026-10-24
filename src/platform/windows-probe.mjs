import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {probeAppServer} from '../runtime-probe.mjs';
import {readRuntimeCompatibility} from '../runtime-compatibility.mjs';
import {removeInstallationTree} from './windows-install.mjs';
import {integrationLog,integrationLogDirectory} from '../diagnostic-log.mjs';

// Exercise the actual .exe/Node/native stdio chain before changing desktop startup.
// A fresh Codex home avoids loading accounts, plugins or model requests.
export async function probeWindowsLauncher(shim,binary){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-launch-probe-')),home=path.join(temp,'codex'),control=path.join(temp,'control');
  fs.mkdirSync(home);fs.writeFileSync(path.join(home,'config.toml'),'[features]\nplugins=false\n[analytics]\nenabled=false\n');
  const started=Date.now();
  const log=(stage,details={})=>integrationLog('probe.'+stage,{elapsedMs:Date.now()-started,...details});
  log('starting',{shim,binary,node:process.execPath});
  try{
    await probeAppServer({command:shim,cwd:temp,timeout:30000,cleanupGrace:2000,onEvent:log,env:{...process.env,CODEX_HOME:home,CONTEXT_CONTROL_CODEX_HOME:home,CONTEXT_CONTROL_HOME:control,CONTEXT_CONTROL_REAL_CODEX:binary,CONTEXT_CONTROL_CONTEXT_CEILING:'0',CONTEXT_CONTROL_NEW_CHAT_DEFAULTS:'0',CONTEXT_CONTROL_DIAGNOSTIC_DIRECTORY:integrationLogDirectory,CONTEXT_CONTROL_DIAGNOSTIC_LOG:path.join(integrationLogDirectory,'launcher.jsonl')}});
    if(readRuntimeCompatibility(control)?.enhanced!==true)throw Object.assign(Error('Enhancement preflight did not pass'),{code:'probe-enhancement-unavailable'});
    return {ok:true};
  }catch(error){
    log('failed',{code:error.code});throw Error(`接入启动检查失败 (${error.code||'probe-failed'})，未更改 Codex 启动配置。请在设置中打开接入日志。`);
  }finally{
    try{const connection=JSON.parse(fs.readFileSync(path.join(control,'connection.json'),'utf8'));await fetch(`http://127.0.0.1:${connection.port}/shutdown`,{method:'POST',headers:{Authorization:`Bearer ${connection.token}`},signal:AbortSignal.timeout(2000)});}catch{}
    // Let the isolated service close its log handles before removing the fixture.
    await new Promise(resolve=>setTimeout(resolve,300));
    try{removeInstallationTree(os.tmpdir(),temp);log('cleaned');}catch(error){log('cleanup_deferred',{directory:temp,code:error.code});}
  }
}
