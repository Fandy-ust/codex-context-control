import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {request} from './ipc.mjs';
import {root,ensureRoot} from './paths.mjs';

export async function ensureDaemon(){
  try{return await request('ping',{},500);}catch{}
  ensureRoot();const log=fs.openSync(path.join(root,'service.log'),'a',0o600);
  const p=spawn(process.execPath,[fileURLToPath(new URL('./daemon.mjs',import.meta.url))],{detached:true,stdio:['ignore',log,log],env:process.env});p.unref();fs.closeSync(log);
  for(let i=0;i<60;i++){await new Promise(r=>setTimeout(r,50));try{return await request('ping',{},500);}catch{}}
  throw new Error('本地控制服务未能启动，请运行 doctor。');
}
