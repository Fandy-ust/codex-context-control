import {spawn,spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {Bridge} from './bridge.mjs';
import {connect,request} from './ipc.mjs';
import {callerRuntime} from './runtime-selection.mjs';
import {ensureDaemon} from './service.mjs';
import {createRuntimeFixManager} from './runtime-fix.mjs';
import {prepareContextCatalog,contextCeilingLaunchArgs} from './context-ceiling.mjs';
import {runtimeSupported,isStdioServer} from './compatibility.mjs';

const args=process.argv.slice(2);const caller=callerRuntime();
const desktop=caller.desktop,originalBinary=caller.binary;
const runtime=desktop&&isStdioServer(args)?createRuntimeFixManager().select(originalBinary):{binary:originalBinary,runtimeFixId:null};
const binary=runtime.binary;
const bridgeVersion=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version;
const nativeVersion=isStdioServer(args)?spawnSync(binary,['--version'],{encoding:'utf8',timeout:5000}).stdout||'':'';
const supported=!isStdioServer(args)||runtimeSupported(nativeVersion);
if(!desktop||!isStdioServer(args)||!supported){
  if(!supported)process.stderr.write('Context Control: 无法识别 Codex 运行时，本次仅透传。\n');
  const p=spawn(binary,args,{stdio:'inherit',env:process.env});p.on('exit',(code,signal)=>signal?process.kill(process.pid,signal):process.exit(code??1));
}else{
  const ceiling=prepareContextCatalog();
  const child=spawn(binary,contextCeilingLaunchArgs(args,ceiling),{stdio:['pipe','pipe','inherit'],env:process.env});
  let peer,closed=false,bridge;
  bridge=new Bridge(child,process.stdin,process.stdout,async thread=>peer?peer.call('updateThread',thread):{},async(id,model)=>{
    await ensureDaemon();return request('forkBudget',{id,model,contextCeiling:!!ceiling});
  },{contextCeiling:ceiling?.version??null,contextCatalogRevision:ceiling?2:null,nativeBudgetSupport:true,resolveNewChatBudget:process.env.CONTEXT_CONTROL_NEW_CHAT_DEFAULTS==='0'?null:async model=>{await ensureDaemon();return request('newChatBudget',{model,contextCeiling:!!ceiling});}});
  async function attach(){
    if(closed)return;
    try{
      await ensureDaemon();peer=await connect(async(op,p)=>{
        if(op==='setPolicy')return bridge.setPolicy(p.id,p.policy,p.model);
        if(op==='clearPolicy')return bridge.clearPolicy(p.id,p.revision);
        if(op==='compact')return bridge.compact(p.id);
        throw new Error('不支持的运行时操作');
      });
      await peer.call('registerBridge',{pid:process.pid,version:bridgeVersion,runtimeFixId:runtime.runtimeFixId,contextCeiling:ceiling?.version??null,contextCatalogRevision:ceiling?2:null,newChatDefaultsVersion:process.env.CONTEXT_CONTROL_NEW_CHAT_DEFAULTS==='0'?null:2});
      for(const record of bridge.records.values())bridge.notify(record);
      peer.socket.once('close',()=>{peer=null;if(!closed)setTimeout(attach,1000).unref();});
    }catch{if(!closed)setTimeout(attach,1500).unref();}
  }
  attach();
  process.stdin.once('end',()=>child.stdin.end());
  child.once('error',error=>{process.stderr.write(`Context Control: ${error.message}\n`);process.exitCode=1;});
  child.once('exit',(code,signal)=>{closed=true;peer?.close();bridge.frontLines.close();bridge.backLines.close();process.exitCode=code??(signal?1:0);});
  process.once('SIGTERM',()=>child.kill('SIGTERM'));process.once('SIGINT',()=>child.kill('SIGINT'));
}
