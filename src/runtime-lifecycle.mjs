import {execFile} from 'node:child_process';
import path from 'node:path';

export function runtimeParentAlive(pid){
  if(process.platform!=='win32'){try{process.kill(pid,0);return true;}catch(error){return error.code!=='ESRCH';}}
  // On Windows kill(pid, 0) can succeed for a terminated process while another
  // process still holds its handle. Query the active process list instead.
  return new Promise(resolve=>execFile(path.join(process.env.SystemRoot||'C:\\Windows','System32/tasklist.exe'),['/FI',`PID eq ${pid}`,'/FO','CSV','/NH'],{windowsHide:true,timeout:3000,encoding:'utf8'},(error,stdout)=>{
    if(error){resolve(true);return;}
    resolve(stdout.split(/\r?\n/).some(line=>new RegExp(`^"[^"\\r\\n]+","${pid}"(?:,|$)`).test(line.trim())));
  }));
}

// Stdio runtimes belong to their client, not to the independently running daemon.
// End the native child even if a client/launcher dies without a protocol shutdown.
export function watchRuntimeLifecycle({child,input,output,parentPid=process.ppid,parentAlive=runtimeParentAlive,interval=2000,grace=3000,eofGrace=30000,onDisconnect=()=>{},exitEvents=process}={}){
  let disconnected=false,forceTimer,eofTimer,checking=false,disposed=false;
  const alive=()=>child.exitCode==null&&child.signalCode==null;
  const force=()=>{if(alive())try{child.kill('SIGKILL');}catch{}};
  const disconnect=(reason='requested')=>{
    if(disconnected||disposed)return;disconnected=true;
    clearTimeout(eofTimer);
    onDisconnect(reason);
    try{child.stdin?.end();}catch{}
    // Native app-server can keep active threads alive after stdin EOF.
    if(alive())try{child.kill('SIGTERM');}catch{}
    forceTimer=setTimeout(force,grace);forceTimer.unref?.();
  };
  const inputEnded=()=>{
    if(disconnected||disposed||eofTimer)return;
    try{child.stdin?.end();}catch{}
    eofTimer=setTimeout(()=>disconnect('stdin-eof-timeout'),eofGrace);eofTimer.unref?.();
  };
  const parentTimer=setInterval(async()=>{
    if(parentPid<=1||checking||disposed||disconnected)return;checking=true;
    try{if(!await parentAlive(parentPid)&&!disposed)disconnect('parent-exited');}catch{/* Unknown liveness never terminates a runtime. */}finally{checking=false;}
  },interval);parentTimer.unref?.();
  const bindings=[[input,'end',inputEnded],[input,'close',inputEnded],[input,'error',()=>disconnect('stdin-error')],[output,'close',()=>disconnect('stdout-closed')],[output,'error',()=>disconnect('stdout-error')]];
  for(const [stream,event,handler]of bindings)stream?.on(event,handler);
  exitEvents.once('exit',force);
  const close=()=>{disposed=true;clearInterval(parentTimer);clearTimeout(forceTimer);clearTimeout(eofTimer);for(const [stream,event,handler]of bindings)stream?.removeListener(event,handler);exitEvents.removeListener('exit',force);};
  child.once('exit',close);
  return {disconnect,close};
}
