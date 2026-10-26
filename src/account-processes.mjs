import fs from 'node:fs';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {windowsProcesses} from './platform/windows-system.mjs';
import {settings,realBinary} from './paths.mjs';

export function accountProcesses({platform=process.platform,list}={}){
  let processes=list?.();
  if(!list){if(platform==='win32')processes=windowsProcesses();else{const result=spawnSync('/bin/ps',['-axo','pid=,stat=,comm='],{encoding:'utf8',timeout:5000});if(result.status===0)processes=result.stdout.split('\n').map(line=>{const match=line.trim().match(/^(\d+)\s+(\S+)\s+(.+)$/);return match?{pid:Number(match[1]),state:match[2],executable:match[3]}:null;}).filter(Boolean);}}
  if(!Array.isArray(processes))throw Error('无法检查 Codex 进程，请稍后重试');
  return processes.filter(p=>Number.isSafeInteger(p.pid)&&p.pid>0&&p.pid!==process.pid&&!/^Z/.test(p.state||'')&&/(?:^|[\\/])(?:codex|codex-context|chatgpt)(?:\.exe)?$/i.test(p.executable||''));
}
export const accountProcessBlocker=options=>accountProcesses(options).length>0;
export function automaticAccountProcesses({list=accountProcesses,bridges=[],desktop=settings().desktopExecutable,platform=process.platform}={}){
  if(!desktop||!fs.existsSync(desktop))throw Error('请先配置可重新打开的 Codex 桌面应用');
  if(bridges.some(b=>b.accountSwitchVersion!==1||!Number.isSafeInteger(b.nativePid)))throw Error('请重新打开 Codex 以启用队列自动切换账号');
  const same=(a,b)=>platform==='win32'?a?.toLowerCase()===b?.toLowerCase():a===b;
  const processes=list();
  if(processes.some(p=>!same(p.executable,desktop)&&!bridges.some(b=>p.pid===b.nativePid||p.pid===b.pid)))throw Error('检测到未接入的 Codex 会话，请退出该会话后再自动切换');
  return processes;
}

// Only called after explicit confirmation. Never kill an IDE or the manager.
export async function stopAccountProcesses({list=accountProcesses,kill=(pid,signal)=>process.kill(pid,signal),wait=ms=>new Promise(r=>setTimeout(r,ms))}={}){
  const targets=new Map();
  const terminate=(target,signal)=>{try{kill(target.pid,signal);}catch(error){if(error.code!=='ESRCH')throw Error('无法停止 Codex 进程，请手动退出后重试');}};
  for(let attempt=0;attempt<40;attempt++){
    const remaining=list();if(!remaining.length)return;
    for(const target of remaining){
      const key=JSON.stringify([target.pid,target.executable]),seen=targets.get(key);
      // A supervisor may start a replacement after the initial inventory. Stop
      // every currently matched Codex process, without signalling its supervisor.
      if(!seen){targets.set(key,{attempt,escalated:false});terminate(target,'SIGTERM');}
      else if(!seen.escalated&&attempt-seen.attempt>=10){seen.escalated=true;terminate(target,'SIGKILL');}
    }
    await wait(100);
  }
  throw Error('Codex 仍在运行，未切换账号，请手动退出后重试');
}
export function windowsStoreAppId(executable){
  const packageDirectory=path.win32.basename(path.win32.dirname(path.win32.dirname(executable)));
  const packageFamily=packageDirectory.match(/^OpenAI\.Codex_.+__([a-z0-9]+)$/i)?.[1];
  return packageFamily&&path.win32.basename(path.win32.dirname(path.win32.dirname(path.win32.dirname(executable)))).toLowerCase()==='windowsapps'?`OpenAI.Codex_${packageFamily}!App`:null;
}
export async function openAccountDesktop({platform=process.platform,configured=settings().desktopExecutable,exists=fs.existsSync,launch=spawn,environment=process.env}={}){
  let command,args=[];
  if(configured&&exists(configured))command=configured;
  else if(platform==='darwin'){const binary=realBinary(),app=binary.match(/^(.+?\.app)\//)?.[1];if(app){command='/usr/bin/open';args=['-a',app];}}
  if(!command)throw Error('请手动打开 Codex');
  const appId=platform==='win32'?windowsStoreAppId(command):null;
  if(appId){command='explorer.exe';args=[`shell:AppsFolder\\${appId}`];}
  const env={...environment};delete env.ELECTRON_RUN_AS_NODE;
  await new Promise((resolve,reject)=>{const child=launch(command,args,{cwd:command==='/usr/bin/open'||appId?undefined:path.dirname(command),env,detached:true,stdio:'ignore',windowsHide:!appId});child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});});
}
