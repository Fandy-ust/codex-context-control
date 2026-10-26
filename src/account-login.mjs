import readline from 'node:readline';
import {spawn} from 'node:child_process';
import {realBinary} from './paths.mjs';

// Own only this isolated native process. Never log protocol payloads or auth URLs.
export function nativeAccountSession({home,binary=realBinary(),launcherArgs=[],timeout=20000,loginTimeout=300000}={}){
  const env={...process.env,CODEX_HOME:home,CONTEXT_CONTROL_CODEX_HOME:home};
  for(const key of ['OPENAI_API_KEY','CODEX_API_KEY','CODEX_ACCESS_TOKEN','OPENAI_ACCESS_TOKEN','OPENAI_IDENTITY_TOKEN_FILE','CODEX_WIF_CONFIG','ELECTRON_RUN_AS_NODE'])delete env[key];
  for(const key of Object.keys(env))if(/^CODEX_WIF_|^OPENAI_IDENTITY_/.test(key))delete env[key];
  const child=spawn(binary,[...launcherArgs,'app-server','--listen','stdio://','-c','cli_auth_credentials_store="file"'],{env,cwd:home,windowsHide:true,stdio:['pipe','pipe','ignore']});
  const exited=new Promise(resolve=>child.once('close',resolve));
  const lines=readline.createInterface({input:child.stdout}),calls=new Map();let sequence=0,closed=false,total=0,login=null,closing;
  function fail(){for(const p of calls.values()){clearTimeout(p.timer);p.reject(Error('账号连接已关闭，请重试'));}calls.clear();login?.reject(Error('账号连接已关闭，请重试'));login=null;}
  function close(){if(closing)return closing;closed=true;fail();lines.close();child.stdin.destroy();child.kill();
    closing=(async()=>{let timer;try{await Promise.race([exited,new Promise(resolve=>{timer=setTimeout(resolve,1500);})]);}finally{clearTimeout(timer);}if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}})();closing.catch(()=>{});return closing;
  }
  child.on('error',close);child.on('exit',close);child.stdin.on('error',close);
  function call(method,params={}){if(closed)return Promise.reject(Error('账号连接已关闭，请重试'));return new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{calls.delete(id);reject(Error('账号请求超时，请重试'));},timeout);calls.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,method,params})+'\n');});}
  lines.on('line',line=>{
    total+=line.length;if(total>4*1024*1024){close();return;}
    let message;try{message=JSON.parse(line);}catch{return;}
    if(calls.has(message.id)){const p=calls.get(message.id);calls.delete(message.id);clearTimeout(p.timer);message.error?p.reject(Error('官方账号请求失败，请重新授权')):p.resolve(message.result);}
    else if(message.method==='account/login/completed'&&login){if(login.id&&message.params?.loginId!==login.id)return;const pending=login;login=null;message.params?.success?pending.resolve():pending.reject(Error('账号授权未完成，请重试'));}
  });
  const ready=call('initialize',{clientInfo:{name:'context_manager_accounts',version:'1'}}).then(()=>{child.stdin.write(JSON.stringify({method:'initialized'})+'\n');});
  ready.catch(()=>{});
  return {close,async rateLimits(){await ready;return call('account/rateLimits/read');},async read({refresh=false,quota=false}={}){await ready;const value=await call('account/read',{refreshToken:refresh});if(quota)await call('account/rateLimits/read');return value?.account;},
    async login(onURL){await ready;
      let timer;const completed=new Promise((resolve,reject)=>{login={resolve,reject,id:null};timer=setTimeout(()=>{login?.reject(Error('账号授权超时，请重试'));login=null;close();},loginTimeout);});completed.catch(()=>{});
      try{const result=await call('account/login/start',{type:'chatgpt'});if(login)login.id=result.loginId;
        const url=new URL(result.authUrl);if(url.protocol!=='https:'||!['auth.openai.com','chatgpt.com'].includes(url.hostname)||url.username||url.password)throw Error('授权地址无效');
        await onURL(url.href);await completed;return await this.read();
      }finally{clearTimeout(timer);}
    }};
}
