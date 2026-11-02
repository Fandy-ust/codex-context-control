import fs from 'node:fs';
import {EventEmitter} from 'node:events';

// The macOS launcher execs the original runtime in its own PID. This process
// owns only the inherited transport; it is a child, never a runtime ancestor.
export function nativeLaunchChannel(env=process.env,{platform=process.platform,parentPid=process.ppid}={}){
  if(platform!=='darwin'||!env.CONTEXT_CONTROL_NATIVE_CHANNEL)return null;
  const value=JSON.parse(env.CONTEXT_CONTROL_NATIVE_CHANNEL);
  if(!['readFd','writeFd','planFd'].every(k=>Number.isInteger(value[k])&&value[k]>2&&value[k]<1048576)||new Set([value.readFd,value.writeFd,value.planFd]).size!==3||value.nativePid!==parentPid||!Number.isInteger(value.clientPid)||value.clientPid<1)throw Error('Invalid inherited runtime transport');
  return value;
}
export function sendNativeLaunchPlan(channel,plan){
  const data=Buffer.from(JSON.stringify(plan));if(data.length>65536)throw Error('Runtime launch plan is too large');
  try{let offset=0;while(offset<data.length)offset+=fs.writeSync(channel.planFd,data,offset);}finally{fs.closeSync(channel.planFd);}
  if(plan.enhanced){const ack=Buffer.alloc(1);return fs.readSync(channel.readFd,ack,0,1,null)===1&&ack[0]===6;}
  return true;
}
export function inheritedRuntime(channel){
  const backend=new EventEmitter();backend.pid=channel.nativePid;backend.exitCode=null;backend.signalCode=null;
  backend.stdin=fs.createWriteStream(null,{fd:channel.writeFd,autoClose:true});backend.stdout=fs.createReadStream(null,{fd:channel.readFd,autoClose:true});
  backend.kill=signal=>{if(backend.exitCode!=null||process.ppid!==backend.pid)return false;try{process.kill(backend.pid,signal);return true;}catch{return false;}};
  backend.stdout.once('end',()=>{backend.exitCode=0;backend.emit('exit',null,null);backend.emit('close',null,null);});
  queueMicrotask(()=>backend.emit('spawn'));return backend;
}
