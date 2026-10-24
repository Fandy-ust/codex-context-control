import {spawn} from 'node:child_process';
import readline from 'node:readline';

const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

// The same complete, read-only handshake is used by both platforms and by the
// Windows executable-chain preflight. Never send a turn or load user accounts.
export async function probeAppServer({command,args=['app-server','--listen','stdio://'],env,cwd,timeout=4000,cleanupGrace=150,onEvent=()=>{}}){
  const event=(name,details={})=>{try{onEvent(name,details);}catch{}};
  const child=spawn(command,args,{env,cwd,windowsHide:true,stdio:['pipe','pipe','pipe']});
  let timer,stage='initialize',stdoutBytes=0,stderrBytes=0;
  const closed=new Promise(resolve=>{child.once('close',resolve);child.once('error',resolve);});
  const lines=readline.createInterface({input:child.stdout,crlfDelay:Infinity});
  try{
    return await new Promise((resolve,reject)=>{
      const fail=code=>reject(Object.assign(new Error('Runtime compatibility check failed: '+code),{code}));
      timer=setTimeout(()=>fail('probe-timeout'),timeout);
      child.once('error',()=>fail('probe-spawn-failed'));
      child.once('close',()=>fail('probe-closed'));
      child.stdin.on('error',()=>fail('probe-input-error'));
      child.stdout.on('error',()=>fail('probe-output-error'));
      child.stderr.on('error',()=>fail('probe-output-error'));
      child.stdout.on('data',chunk=>{stdoutBytes+=chunk.length;if(stdoutBytes>8*1024*1024)fail('probe-output-limit');});
      child.stderr.on('data',chunk=>{stderrBytes+=chunk.length;});
      const send=message=>child.stdin.write(JSON.stringify(message)+'\n',error=>{if(error)fail('probe-input-error');});
      lines.on('line',line=>{
        let message;try{message=JSON.parse(line);}catch{fail('probe-invalid-json');return;}
        if(!object(message)){fail('probe-invalid-message');return;}
        if(message.method||message.id!==(stage==='initialize'?1:2))return;
        if(message.error||!object(message.result)){fail('probe-'+stage+'-rejected');return;}
        if(stage==='initialize'){
          event('initialize_response',{ok:true});stage='config';
          send({method:'initialized'});
          send({id:2,method:'config/read',params:{includeLayers:false}});
        }else{
          if(!object(message.result.config)){fail('probe-config-shape');return;}
          event('ready',{stdoutBytes,stderrBytes});resolve({ok:true,config:message.result.config});
        }
      });
      send({id:1,method:'initialize',params:{clientInfo:{name:'context_manager_preflight',version:'2'},capabilities:{experimentalApi:true}}});
      event('initialize_written');
    });
  }finally{
    clearTimeout(timer);lines.close();child.stdin.end();
    await Promise.race([closed,delay(cleanupGrace)]);
    if(child.exitCode==null&&child.signalCode==null){child.kill('SIGKILL');await Promise.race([closed,delay(300)]);}
    child.stdin.destroy();child.stdout.destroy();child.stderr.destroy();child.unref();
  }
}
