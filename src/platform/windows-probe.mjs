import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import {spawn} from 'node:child_process';
import {removeInstallationTree} from './windows-install.mjs';
import {integrationLog,integrationLogDirectory} from '../diagnostic-log.mjs';

// Exercise the actual .exe/Node/native stdio chain before changing desktop startup.
// A fresh Codex home avoids loading accounts, plugins or model requests.
export async function probeWindowsLauncher(shim,binary){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-launch-probe-')),home=path.join(temp,'codex'),control=path.join(temp,'control');
  fs.mkdirSync(home);fs.writeFileSync(path.join(home,'config.toml'),'[features]\nplugins=false\n[analytics]\nenabled=false\n');
  const started=Date.now();let lastStage='preparing',stdoutBytes=0,stderrBytes=0;
  const log=(stage,details={})=>{lastStage=stage;integrationLog('probe.'+stage,{elapsedMs:Date.now()-started,...details});};
  log('starting',{shim,binary,node:process.execPath});
  const child=spawn(shim,['app-server','--listen','stdio://'],{cwd:temp,windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,CODEX_HOME:home,CONTEXT_CONTROL_CODEX_HOME:home,CONTEXT_CONTROL_HOME:control,CONTEXT_CONTROL_REAL_CODEX:binary,CONTEXT_CONTROL_CONTEXT_CEILING:'0',CONTEXT_CONTROL_NEW_CHAT_DEFAULTS:'0',CONTEXT_CONTROL_DIAGNOSTIC_DIRECTORY:integrationLogDirectory,CONTEXT_CONTROL_DIAGNOSTIC_LOG:path.join(integrationLogDirectory,'launcher.jsonl')}});
  let stderr='',timer;const closed=new Promise(resolve=>{child.once('close',resolve);child.once('error',resolve);});
  child.once('spawn',()=>log('process_spawned',{childPid:child.pid}));
  child.once('exit',(code,signal)=>log('process_exit',{code,signal,stdoutBytes,stderrBytes}));
  child.stdout.on('data',chunk=>{if(!stdoutBytes)log('first_stdout',{bytes:chunk.length});stdoutBytes+=chunk.length;});
  child.stderr.on('data',chunk=>{if(!stderrBytes)log('first_stderr',{bytes:chunk.length});stderrBytes+=chunk.length;stderr=(stderr+chunk).slice(-2000);});
  child.stdin.on('error',error=>log('stdin_error',{code:error.code}));
  const lines=readline.createInterface({input:child.stdout});
  try{
    await new Promise((resolve,reject)=>{
      timer=setTimeout(()=>{
        log('timeout',{lastStage,stdoutBytes,stderrBytes});
        reject(Error('接入启动检查超时，未更改 Codex 启动配置。请在设置中打开接入日志。'));
      },30000);
      child.once('error',reject);child.once('exit',code=>reject(Error(`接入启动检查失败 (${code})：${stderr.trim()}`)));
      lines.on('line',line=>{try{const message=JSON.parse(line);if(message.id===1){log('initialize_response',{ok:!!message.result,errorCode:message.error?.code});if(message.error)reject(Error('接入初始化被拒绝：'+JSON.stringify(message.error)));else if(message.result)resolve();}}catch{log('invalid_protocol',{lineBytes:Buffer.byteLength(line)});reject(Error('接入进程输出不是有效的 JSON 协议。'));}});
      const request=JSON.stringify({id:1,method:'initialize',params:{clientInfo:{name:'context_manager_preflight',version:'1'},capabilities:{experimentalApi:true}}})+'\n';
      child.stdin.write(request,error=>{if(error)reject(error);else log('initialize_written',{bytes:Buffer.byteLength(request)});});
    });
    log('ready',{stdoutBytes,stderrBytes});return {ok:true};
  }catch(error){
    log('failed',{message:error.message,stdoutBytes,stderrBytes});throw error;
  }finally{
    clearTimeout(timer);lines.close();child.stdin.end();
    await Promise.race([closed,new Promise(resolve=>setTimeout(resolve,2000).unref())]);
    if(child.exitCode==null&&child.signalCode==null){child.kill();await closed;}
    try{const connection=JSON.parse(fs.readFileSync(path.join(control,'connection.json'),'utf8'));await fetch(`http://127.0.0.1:${connection.port}/shutdown`,{method:'POST',headers:{Authorization:`Bearer ${connection.token}`},signal:AbortSignal.timeout(2000)});}catch{}
    // Let the isolated service close its log handles before removing the fixture.
    await new Promise(resolve=>setTimeout(resolve,300));
    try{removeInstallationTree(os.tmpdir(),temp);log('cleaned');}catch(error){log('cleanup_deferred',{directory:temp,code:error.code});}
  }
}
