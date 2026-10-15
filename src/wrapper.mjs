import {spawn,spawnSync} from 'node:child_process';
import {Bridge} from './bridge.mjs';
import {connect} from './ipc.mjs';
import {callerRuntime} from './runtime-selection.mjs';
import {ensureDaemon} from './service.mjs';
import {runtimeSupported,isStdioServer} from './compatibility.mjs';

const args=process.argv.slice(2);const {binary,desktop}=callerRuntime();
const supported=!isStdioServer(args)||runtimeSupported(spawnSync(binary,['--version'],{encoding:'utf8'}).stdout||'');
if(!desktop||!isStdioServer(args)||!supported){
  if(!supported)process.stderr.write('Context Control: 当前运行时版本未经验证，本次仅透传。\n');
  const p=spawn(binary,args,{stdio:'inherit',env:process.env});p.on('exit',(code,signal)=>signal?process.kill(process.pid,signal):process.exit(code??1));
}else{
  const child=spawn(binary,args,{stdio:['pipe','pipe','inherit'],env:process.env});
  let peer,closed=false,bridge;
  bridge=new Bridge(child,process.stdin,process.stdout,async thread=>peer?peer.call('updateThread',thread):{});
  async function attach(){
    if(closed)return;
    try{
      await ensureDaemon();peer=await connect(async(op,p)=>{
        if(op==='setPolicy')return bridge.setPolicy(p.id,p.policy,p.model);
        if(op==='clearPolicy')return bridge.clearPolicy(p.id);
        if(op==='compact')return bridge.compact(p.id);
        throw new Error('不支持的运行时操作');
      });
      await peer.call('registerBridge',{pid:process.pid});
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
