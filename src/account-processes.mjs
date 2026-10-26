import fs from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import {windowsProcesses} from './platform/windows-system.mjs';
import {settings,realBinary} from './paths.mjs';

export function accountProcesses({platform=process.platform,list}={}){
  let processes=list?.();
  if(!list){if(platform==='win32')processes=windowsProcesses();else{const result=spawnSync('/bin/ps',['-axo','pid=,comm='],{encoding:'utf8',timeout:5000});if(result.status===0)processes=result.stdout.split('\n').map(line=>{const match=line.trim().match(/^(\d+)\s+(.+)$/);return match?{pid:Number(match[1]),executable:match[2]}:null;}).filter(Boolean);}}
  if(!Array.isArray(processes))throw Error('无法检查 Codex 进程，请稍后重试');
  return processes.filter(p=>Number.isSafeInteger(p.pid)&&p.pid>0&&p.pid!==process.pid&&/(?:^|[\\/])(?:codex(?:-[\w-]+)?|chatgpt)(?:\.exe)?$/i.test(p.executable||''));
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
  const targets=list();
  for(const target of targets){try{kill(target.pid,'SIGTERM');}catch(error){if(error.code!=='ESRCH')throw Error('无法停止 Codex 进程，请手动退出后重试');}}
  for(let attempt=0;attempt<40;attempt++){
    const remaining=list();if(!remaining.length)return;
    // Recheck both PID and executable before escalating; do not kill a reused PID.
    if(attempt===10)for(const target of remaining){if(targets.some(p=>p.pid===target.pid&&p.executable===target.executable))try{kill(target.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw Error('无法停止 Codex 进程，请手动退出后重试');}}
    await wait(100);
  }
  throw Error('Codex 仍在运行，未切换账号，请手动退出后重试');
}
export function openAccountDesktop(){
  let command,args=[];const configured=settings().desktopExecutable;
  if(configured&&fs.existsSync(configured))command=configured;
  else if(process.platform==='darwin'){const binary=realBinary(),app=binary.match(/^(.+?\.app)\//)?.[1];if(app){command='/usr/bin/open';args=['-a',app];}}
  if(!command)throw Error('请手动打开 Codex');
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  return new Promise((resolve,reject)=>{const child=spawn(command,args,{env,detached:true,stdio:'ignore',windowsHide:true});child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});});
}
