import {spawn,spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {request} from './ipc.mjs';
import {root,ensureRoot,settings} from './paths.mjs';
import {windows,processInfo} from './platform/index.mjs';
import {canonicalLocalPath,normalizeLocalPath} from './local-path.mjs';
import {buildId} from './version.mjs';

function installedWindowsDaemon(connection){
  if(!windows||typeof connection.script!=='string'||!settings().installBase)return null;
  try{
    const base=canonicalLocalPath(settings().installBase),script=canonicalLocalPath(connection.script);
    const relative=normalizeLocalPath(path.relative(base,script));
    if(!/^versions[\\/]\d+\.\d+\.\d+-[a-f0-9]{8,64}[\\/]resources[\\/]app[\\/]src[\\/]daemon\.mjs$/i.test(relative))return null;
    const runtime=path.join(path.dirname(path.dirname(script)),'vendor','node.exe');
    if(!fs.existsSync(runtime))return null;
    return {script,runtime};
  }catch{return null;}
}
function sameWindowsPath(left,right){
  try{return canonicalLocalPath(left).toLowerCase()===canonicalLocalPath(right).toLowerCase();}catch{return false;}
}

export async function ensureDaemon(){
  const version=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8')).version;
  let existing;try{existing=await request('ping',{},500);}catch{}
  if(existing?.version===version&&(existing.buildId??null)===buildId)return existing;
  if(/^\d+\.\d+\.\d+$/.test(existing?.version)&&existing.version.localeCompare(version,'en',{numeric:true})>0)return existing;
  if(existing){
    const connection=JSON.parse(fs.readFileSync(path.join(root,'connection.json'),'utf8'));
    const allowed=[fileURLToPath(new URL('./daemon.mjs',import.meta.url)),path.join(root,'code/src/daemon.mjs')];
    const installed=installedWindowsDaemon(connection);
    if(installed)allowed.push(connection.script,installed.script);
    const info=windows&&Number.isSafeInteger(connection.pid)&&connection.pid>0?processInfo(connection.pid):null;
    const command=windows?info?.command:spawnSync('/bin/ps',['-p',String(connection.pid),'-o','command='],{encoding:'utf8',timeout:2000}).stdout?.trim();
    const commandMatches=allowed.some(file=>{const c=windows?normalizeLocalPath(command??'').toLowerCase():command,p=windows?normalizeLocalPath(file).toLowerCase():file;return c?.endsWith(' '+p)||c?.includes('"'+p+'"');});
    // Windows may expose ExecutablePath while CommandLine is unavailable. For
    // installed services, the recorded script and its bundled Node executable
    // together still identify the daemon without trusting an unrelated PID.
    const installedProcessMatches=!!installed&&info?.pid===connection.pid&&sameWindowsPath(info.executable,installed.runtime)&&(!connection.executable||sameWindowsPath(info.executable,connection.executable));
    if(!Number.isSafeInteger(connection.pid)||connection.pid<1||(!commandMatches&&!installedProcessMatches))throw new Error('旧控制服务的进程路径无法确认，暂未自动更新。');
    if(windows){const r=await fetch(`http://127.0.0.1:${connection.port}/shutdown`,{method:'POST',headers:{Authorization:`Bearer ${connection.token}`},signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error('控制服务暂不能安全更新，请稍后重试。');}
    else process.kill(connection.pid,'SIGTERM');
    let stopped=false;
    for(let i=0;i<40;i++){try{process.kill(connection.pid,0);}catch{stopped=true;break;}await new Promise(r=>setTimeout(r,50));}
    if(!stopped)throw new Error('旧控制服务尚未退出，请稍后重试。');
  }
  ensureRoot();const log=fs.openSync(path.join(root,'service.log'),'a',0o600);
  const node=process.env.CONTEXT_CONTROL_NODE||settings().node||process.execPath;
  const p=spawn(node,[fileURLToPath(new URL('./daemon.mjs',import.meta.url))],{cwd:fileURLToPath(new URL('./',import.meta.url)),detached:true,windowsHide:true,stdio:['ignore',log,log],env:process.env});p.on('error',()=>{});p.unref();fs.closeSync(log);
  for(let i=0;i<60;i++){await new Promise(r=>setTimeout(r,50));try{return await request('ping',{},500);}catch{}}
  throw new Error('本地控制服务未能启动，请运行 doctor。');
}
