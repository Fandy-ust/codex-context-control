import {spawn} from 'node:child_process';
import readline from 'node:readline';
import {realBinary,codexHome} from './paths.mjs';

// A read-only native app-server session: no thread creation, model requests,
// credentials export, or dependence on an already-open desktop chat.
export function readAccountQuota({binary=realBinary(),timeout=20000,launcherArgs=[]}={}){
 return new Promise((resolve,reject)=>{
  const child=spawn(binary,[...launcherArgs,'app-server','--listen','stdio://'],{windowsHide:true,stdio:['pipe','pipe','ignore'],env:{...process.env,CODEX_HOME:codexHome}});
  let done=false,sequence=0,total=0;const pending=new Map();
  const lines=readline.createInterface({input:child.stdout});
  const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);lines.close();child.stdin.end();child.kill('SIGTERM');for(const p of pending.values())p.reject(error??Error('Quota session closed'));pending.clear();error?reject(error):resolve(value);};
  const timer=setTimeout(()=>finish(Error('额度读取超时')),timeout);
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});child.stdin.write(JSON.stringify({id,method,params})+'\n');});
  child.on('error',error=>finish(error));child.stdin.on('error',error=>finish(error));
  child.on('exit',()=>{if(!done)finish(Error('额度连接已关闭'));});
  lines.on('line',line=>{total+=line.length;if(total>2*1024*1024){finish(Error('额度响应过大'));return;}let message;try{message=JSON.parse(line);}catch{return;}const p=pending.get(message.id);if(p){pending.delete(message.id);message.error?p.reject(Error(message.error.message??'额度不可用')):p.resolve(message.result);}});
  (async()=>{try{await call('initialize',{clientInfo:{name:'context_manager_quota',version:'1'}});child.stdin.write(JSON.stringify({method:'initialized'})+'\n');finish(null,await call('account/rateLimits/read'));}catch(error){finish(error);}})();
 });
}
function window(value){
 if(!value||typeof value.usedPercent!=='number'||!Number.isFinite(value.usedPercent))return null;
 const usedPercent=Math.max(0,Math.min(100,value.usedPercent));
 return {usedPercent,remainingPercent:100-usedPercent,windowDurationMins:Number.isSafeInteger(value.windowDurationMins)&&value.windowDurationMins>0?value.windowDurationMins:null,resetsAt:Number.isSafeInteger(value.resetsAt)&&value.resetsAt>0?value.resetsAt:null};
}
export function creditBalance(credits){
 if(credits?.unlimited===true)return null;
 const raw=typeof credits?.balance==='string'?credits.balance.trim():typeof credits?.balance==='number'?String(credits.balance):'';
 return raw.length<=64&&/^\d+(?:\.\d+)?$/.test(raw)&&Number.isFinite(Number(raw))?raw:null;
}
export function normalizeQuota(response){
 const source=response?.rateLimitsByLimitId;
 const entries=source&&typeof source==='object'&&Object.keys(source).length?Object.entries(source):response?.rateLimits?[['codex',response.rateLimits]]:[];
 return entries.map(([id,value])=>({id,name:typeof value?.limitName==='string'?value.limitName.slice(0,100):id,primary:window(value?.primary),secondary:window(value?.secondary),creditBalance:creditBalance(value?.credits),hasCredits:value?.credits?.hasCredits===true,unlimitedCredits:value?.credits?.unlimited===true})).filter(v=>v.primary||v.secondary||v.creditBalance!=null||v.hasCredits||v.unlimitedCredits).sort((a,b)=>(a.id==='codex'?-1:b.id==='codex'?1:a.id.localeCompare(b.id)));
}
export function createQuotaManager({read=readAccountQuota,now=Date.now,interval=5*60*1000}={}){
 let buckets=[],updatedAt=null,checkedAt=0,error=null,pending;
 function state(){return {buckets,updatedAt,loading:!!pending,stale:!!error||!!updatedAt&&now()-updatedAt>interval*2,error};}
 async function refresh(force=false){
  if(pending){await pending;return state();}if(checkedAt&&now()-checkedAt<(force?10000:interval))return state();checkedAt=now();
  pending=(async()=>{try{buckets=normalizeQuota(await read());updatedAt=now();error=buckets.length?null:'当前账户暂无额度数据';}catch{error='暂时无法读取额度';}return state();})().finally(()=>{pending=null;});
  await pending;return state();
 }
 return {state,refresh};
}
