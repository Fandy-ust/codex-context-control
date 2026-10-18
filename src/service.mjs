import {spawn,spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {request} from './ipc.mjs';
import {root,ensureRoot,settings} from './paths.mjs';
import {windows,processInfo} from './platform/index.mjs';
import {canonicalLocalPath,normalizeLocalPath} from './local-path.mjs';
import {buildId} from './version.mjs';

export async function ensureDaemon(){
  const version=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8')).version;
  let existing;try{existing=await request('ping',{},500);}catch{}
  if(existing?.version===version&&(existing.buildId??null)===buildId)return existing;
  if(/^\d+\.\d+\.\d+$/.test(existing?.version)&&existing.version.localeCompare(version,'en',{numeric:true})>0)return existing;
  if(existing){
    const connection=JSON.parse(fs.readFileSync(path.join(root,'connection.json'),'utf8'));
    const allowed=[fileURLToPath(new URL('./daemon.mjs',import.meta.url)),path.join(root,'code/src/daemon.mjs')];
    if(windows&&typeof connection.script==='string'&&settings().installBase){
      const relative=path.relative(canonicalLocalPath(settings().installBase),canonicalLocalPath(connection.script));
      if(/^versions[\\/]\d+\.\d+\.\d+-[a-f0-9]{12}[\\/]resources[\\/]app[\\/]src[\\/]daemon\.mjs$/.test(relative)&&fs.existsSync(connection.script))allowed.push(connection.script,canonicalLocalPath(connection.script));
    }
    const command=windows?processInfo(connection.pid)?.command:spawnSync('/bin/ps',['-p',String(connection.pid),'-o','command='],{encoding:'utf8',timeout:2000}).stdout?.trim();
    if(!Number.isSafeInteger(connection.pid)||connection.pid<1||!allowed.some(file=>{const c=windows?normalizeLocalPath(command??'').toLowerCase():command,p=windows?normalizeLocalPath(file).toLowerCase():file;return c?.endsWith(' '+p)||c?.includes('"'+p+'"');}))throw new Error('旧控制服务的进程路径无法确认，暂未自动更新。');
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
