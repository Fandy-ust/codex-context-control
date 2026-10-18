import {spawnSync} from 'node:child_process';
export function posixProcessInfo(pid){
 if(!Number.isSafeInteger(pid)||pid<1)return null;
 // Read each field separately: comm may contain spaces in an application path.
 const read=field=>spawnSync('/bin/ps',['-p',String(pid),'-o',field+'='],{encoding:'utf8',timeout:2000}).stdout?.trim();
 const parent=Number(read('ppid')),executable=read('comm'),command=read('args');
 return parent>=0&&executable&&command?{pid,parent,executable,command}:null;
}
