import {spawn} from 'node:child_process';
import {watchRuntimeLifecycle} from './runtime-lifecycle.mjs';
import {readFileSync} from 'node:fs';
import {callerRuntime} from './runtime-selection.mjs';
import {classifyRuntimeCommand} from './compatibility.mjs';
import {settings,root} from './paths.mjs';
import {checkRuntimeCompatibility,recordRuntimeStartupFailure} from './runtime-compatibility.mjs';
import {integrationLog} from './diagnostic-log.mjs';

const startupAt=Date.now();integrationLog('wrapper.boot',{node:process.execPath,argumentCount:process.argv.length-2});
const args=process.argv.slice(2);const caller=callerRuntime();
const desktop=caller.desktop&&settings().uninstalled!==true,originalBinary=caller.binary;
const command=classifyRuntimeCommand(args);
integrationLog('wrapper.runtime_selected',{desktop,binary:originalBinary,node:process.execPath,...command});
const metadata=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')),bridgeVersion=metadata.version;
let runtime={binary:originalBinary,runtimeFixId:null},ceiling,launchArgs=args,compatibility,enhanced=false;
let Bridge,createCompensationResolver,connect,request,ensureDaemon;
if(desktop&&command.stdio){
  try{
    // Unknown/short-lived commands never load enhancement modules or start the
    // control service. All fallible preparation happens before consuming stdin.
    const [{createRuntimeFixManager},{prepareContextCatalog,contextCeilingLaunchArgs},bridge,compensation,ipc,service]=await Promise.all([
      import('./runtime-fix.mjs'),import('./context-ceiling.mjs'),import('./bridge.mjs'),
      import('./compaction-compensation.mjs'),import('./ipc.mjs'),import('./service.mjs')]);
    runtime=createRuntimeFixManager().select(originalBinary);
    ceiling=prepareContextCatalog();launchArgs=contextCeilingLaunchArgs(args,ceiling);
    compatibility=await checkRuntimeCompatibility({binary:runtime.binary,home:root,managerVersion:bridgeVersion+':'+(metadata.buildId??'source'),extraArgs:ceiling?.args??[]});
    if(compatibility.enhanced){
      ({Bridge}=bridge);({createCompensationResolver}=compensation);({connect,request}=ipc);({ensureDaemon}=service);enhanced=true;
    }
  }catch{compatibility={enhanced:false,reason:'enhancement-preparation-failed'};}
  integrationLog('wrapper.runtime_checked',{...compatibility,elapsedMs:Date.now()-startupAt});
}
if(!enhanced){
  if(desktop&&command.stdio)process.stderr.write(`Context Manager: 增强兼容性尚未确认，本次使用原生启动 (${compatibility?.reason})。\n`);
  const p=spawn(originalBinary,args,{stdio:'inherit',env:process.env});p.on('exit',(code,signal)=>signal?process.kill(process.pid,signal):process.exit(code??1));
  p.once('error',error=>{integrationLog('wrapper.passthrough_error',{code:error.code,message:error.message});process.stderr.write('Context Manager: '+error.message+'\n');process.exitCode=1;});
}else{
  const child=spawn(runtime.binary,launchArgs,{stdio:['pipe','pipe','inherit'],env:process.env});
  child.once('spawn',()=>integrationLog('wrapper.native_started',{childPid:child.pid,contextCeiling:!!ceiling?.version}));
  child.once('exit',(code,signal)=>integrationLog('wrapper.native_exit',{code,signal}));
  let peer,closed=false,bridge;
  bridge=new Bridge(child,process.stdin,process.stdout,async thread=>peer?peer.call('updateThread',thread):{},async(id,model)=>{
    await ensureDaemon();return request('forkBudget',{id,model,contextCeiling:!!ceiling?.version});
  },{resolveCompensation:createCompensationResolver(),accountingWindowLimit:ceiling?.accountingWindowLimit,contextCeiling:ceiling?.version??null,contextCatalogRevision:ceiling?.version?2:null,nativeBudgetSupport:true,resolveNewChatBudget:process.env.CONTEXT_CONTROL_NEW_CHAT_DEFAULTS==='0'?null:async model=>{await ensureDaemon();return request('newChatBudget',{model,contextCeiling:!!ceiling?.version});}});
  async function attach(){
    if(closed)return;
    try{
      await ensureDaemon();if(closed)return;peer=await connect(async(op,p)=>{
        if(op==='setPolicy')return bridge.setPolicy(p.id,p.policy,p.model);
        if(op==='clearPolicy')return bridge.clearPolicy(p.id,p.revision);
        if(op==='compact')return bridge.compact(p.id);
        if(op==='queue-start'){try{return await bridge.startAutomatic(p.id,p.task);}catch(error){const task=bridge.records.get(p.id)?.automaticTask;if(task?.executionId===p.task.executionId&&task.status==='running')return task;return {executionId:p.task.executionId,taskId:p.task.taskId,status:'error',error:error.message,errorConfirmed:task?.executionId!==p.task.executionId||task.errorConfirmed===true};}}
        if(op==='queue-prepare')return bridge.prepareAutomatic(p.id);
        if(op==='queue-interrupt')return bridge.interruptAutomatic(p.id,p.executionId);
        if(op==='credits-stop')return bridge.interruptCurrentTurns();
        if(op==='account-prepare')return bridge.prepareAccountSwitch();
        if(op==='account-release')return bridge.releaseAccountSwitch();
        throw new Error('不支持的运行时操作');
      });
      if(closed){peer.close();return;}
      await peer.call('registerBridge',{pid:process.pid,nativePid:child.pid,accountSwitchVersion:1,creditsStopVersion:1,version:bridgeVersion,taskQueueVersion:4,compensationVersion:ceiling?.accountingWindowLimit?3:2,runtimeFixId:runtime.runtimeFixId,contextCeiling:ceiling?.version??null,contextCatalogRevision:ceiling?.version?2:null,newChatDefaultsVersion:process.env.CONTEXT_CONTROL_NEW_CHAT_DEFAULTS==='0'?null:2});
      if(closed){peer.close();return;}
      for(const record of bridge.records.values())bridge.notify(record);
      peer.socket.once('close',()=>{peer=null;if(!closed)setTimeout(attach,1000).unref();});
    }catch(error){integrationLog('wrapper.service_attach_failed',{message:error.message});if(!closed)setTimeout(attach,1500).unref();}
  }
  attach();
  const lifecycle=watchRuntimeLifecycle({child,input:process.stdin,output:process.stdout,onDisconnect:reason=>{closed=true;peer?.close();integrationLog('wrapper.client_disconnected',{reason,parentPid:process.ppid,childPid:child.pid});}});
  child.stdin.on('error',error=>{if(!closed&&!bridge.initialized)recordRuntimeStartupFailure(root,compatibility);integrationLog('wrapper.native_input_error',{code:error.code});lifecycle.disconnect('native-input-error');});
  child.once('error',error=>{recordRuntimeStartupFailure(root,compatibility);closed=true;peer?.close();process.stderr.write(`Context Control: ${error.message}\n`);process.exitCode=1;});
  child.once('exit',(code,signal)=>{
    // Never restart/replay an established stream. Only the next launch may use
    // native mode after an unexpected pre-initialization startup failure.
    if(!closed&&!bridge.initialized&&(code!==0||signal))recordRuntimeStartupFailure(root,compatibility);
    closed=true;peer?.close();process.exitCode=code??(signal?1:0);
  });
  child.once('close',()=>{bridge.frontLines.close();bridge.backLines.close();});
  process.once('SIGTERM',()=>child.kill('SIGTERM'));process.once('SIGINT',()=>child.kill('SIGINT'));
}
