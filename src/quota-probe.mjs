import {spawn} from 'node:child_process';
import readline from 'node:readline';
import {realBinary,codexHome} from './paths.mjs';

// An isolated, ephemeral, read-only turn. Never resume or interrupt a user chat.
export function runQuotaProbe({binary=realBinary(),launcherArgs=[],signal,timeout=20000}={}){
  return new Promise((resolve,reject)=>{
    if(signal?.aborted){reject(Error('探测已取消'));return;}
    const child=spawn(binary,[...launcherArgs,'app-server','--listen','stdio://'],{windowsHide:true,stdio:['pipe','pipe','ignore'],env:{...process.env,CODEX_HOME:codexHome}});
    const lines=readline.createInterface({input:child.stdout}),pending=new Map();
    let sequence=0,done=false,threadId,turnId,stopping=false,received=false,total=0,stopTimer;
    const finish=error=>{if(done)return;done=true;clearTimeout(timer);clearTimeout(stopTimer);signal?.removeEventListener('abort',cancel);lines.close();child.stdin.end();child.kill();for(const p of pending.values())p.reject(Error('Probe closed'));pending.clear();error?reject(error):resolve({received});};
    const call=(method,params={})=>new Promise((resolve,reject)=>{if(done){reject(Error('Probe closed'));return;}const id=++sequence;pending.set(id,{resolve,reject});child.stdin.write(JSON.stringify({id,method,params})+'\n');});
    const stop=async(error)=>{if(stopping||done)return;stopping=true;stopTimer=setTimeout(()=>finish(error??Error('探测停止超时')),2000);try{if(threadId&&turnId)await call('turn/interrupt',{threadId,turnId});finish(error);}catch(e){finish(error??e);}};
    const cancel=()=>void stop(Error('探测已取消'));
    const timer=setTimeout(()=>void stop(Error('探测超时')),timeout);
    signal?.addEventListener('abort',cancel,{once:true});
    child.on('error',finish);child.stdin.on('error',finish);child.on('exit',()=>finish(Error('探测连接已关闭')));
    lines.on('line',line=>{
      total+=line.length;if(total>1024*1024){void stop(Error('探测响应过大'));return;}
      let m;try{m=JSON.parse(line);}catch{return;}
      const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message??'探测失败')):p.resolve(m.result);return;}
      // Deny any unexpected server request; this probe never needs tools.
      if(m.id!=null){child.stdin.write(JSON.stringify({id:m.id,error:{code:-32601,message:'Tools are disabled for quota probe'}})+'\n');return;}
      if(m.params?.threadId!==threadId)return;
      if(m.method==='turn/started')turnId=m.params.turn?.id??turnId;
      if(m.method==='item/agentMessage/delta'&&m.params.delta){received=true;if(turnId)void stop();}
      if(m.method==='turn/completed'){const turn=m.params.turn;finish(turn?.error||turn?.status==='failed'?Error(turn?.error?.message??'探测失败'):undefined);}
    });
    (async()=>{try{
      await call('initialize',{clientInfo:{name:'context_manager_quota_probe',version:'1'}});
      child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
      const created=await call('thread/start',{model:'gpt-6-luna',ephemeral:true,approvalPolicy:'never',sandbox:'read-only',config:{model_reasoning_effort:'low'},developerInstructions:'Reply only OK. Do not use tools, inspect files, or perform any other action.'});
      threadId=created?.thread?.id;if(!threadId)throw Error('未返回探测对话');
      const result=await call('turn/start',{threadId,model:'gpt-6-luna',effort:'low',input:[{type:'text',text:'Reply only OK.',text_elements:[]}],approvalPolicy:'never',sandboxPolicy:{type:'readOnly'}});
      turnId=result?.turn?.id??turnId;if(!turnId)throw Error('未返回探测轮次');if(received)await stop();
    }catch(error){finish(error);}})();
  });
}
