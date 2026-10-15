import {spawn,spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {request} from './ipc.mjs';
import {root,ensureRoot} from './paths.mjs';

export async function ensureDaemon(){
  const version=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8')).version;
  let existing;try{existing=await request('ping',{},500);}catch{}
  if(existing?.version===version)return existing;
  if(/^\d+\.\d+\.\d+$/.test(existing?.version)&&existing.version.localeCompare(version,'en',{numeric:true})>0)return existing;
  if(existing){
    const connection=JSON.parse(fs.readFileSync(path.join(root,'connection.json'),'utf8'));
    const allowed=[fileURLToPath(new URL('./daemon.mjs',import.meta.url)),path.join(root,'code/src/daemon.mjs')];
    const command=spawnSync('/bin/ps',['-p',String(connection.pid),'-o','command='],{encoding:'utf8',timeout:2000}).stdout?.trim();
    if(!Number.isSafeInteger(connection.pid)||connection.pid<1||!allowed.some(file=>command?.endsWith(' '+file)))throw new Error('旧控制服务的进程路径无法确认，暂未自动更新。');
    process.kill(connection.pid,'SIGTERM');
    let stopped=false;
    for(let i=0;i<40;i++){try{process.kill(connection.pid,0);}catch{stopped=true;break;}await new Promise(r=>setTimeout(r,50));}
    if(!stopped)throw new Error('旧控制服务尚未退出，请稍后重试。');
  }
  ensureRoot();const log=fs.openSync(path.join(root,'service.log'),'a',0o600);
  const p=spawn(process.execPath,[fileURLToPath(new URL('./daemon.mjs',import.meta.url))],{detached:true,stdio:['ignore',log,log],env:process.env});p.unref();fs.closeSync(log);
  for(let i=0;i<60;i++){await new Promise(r=>setTimeout(r,50));try{return await request('ping',{},500);}catch{}}
  throw new Error('本地控制服务未能启动，请运行 doctor。');
}
