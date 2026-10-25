import {observeQuotaResets} from './core/quota-reset-notifications.mjs';
import {spawn} from 'node:child_process';
import readline from 'node:readline';
import {realBinary,codexHome} from './paths.mjs';
import path from 'node:path';
import {readJSON,atomicJSON} from './paths.mjs';
import {observeCreditBalance} from './credit-baseline.mjs';

// A read-only native app-server session: no thread creation, model requests,
// credentials export, or dependence on an already-open desktop chat.
export function readAccountQuota({binary=realBinary(),timeout=20000,launcherArgs=[],includeAccount=false}={}){
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
  (async()=>{try{
    await call('initialize',{clientInfo:{name:'context_manager_quota',version:'1'}});child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
    const response=await call('account/rateLimits/read');
    if(includeAccount){let accountTimer;try{const info=await Promise.race([call('account/read',{refreshToken:false}).catch(()=>null),new Promise(resolve=>{accountTimer=setTimeout(()=>resolve(null),1500);})]);response.account=info?.account??null;}finally{clearTimeout(accountTimer);}}
    finish(null,response);
  }catch(error){finish(error);}})();
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
export function createQuotaManager({read=()=>readAccountQuota({includeAccount:true}),now=Date.now,interval=10000,home=null,onObservation=null}={}){
 let buckets=[],updatedAt=null,checkedAt=0,error=null,pending,paused=false;
 const preferencesFile=home?path.join(home,'quota-preferences.json'):null;
 let preferences;try{preferences=preferencesFile?readJSON(preferencesFile,{}):{};}catch{preferences={};}
 const resetFile=home?path.join(home,'quota-reset-notifications.json'):null;
 let resetState;try{resetState=resetFile?readJSON(resetFile,null):null;}catch{resetState=null;}
 let creditBaselines=preferences?.creditBaselines??{},creditScope=preferences?.creditScope??null;
 const creditAccounts=preferences?.creditAccounts??{};
 const accounts=preferences?.accounts??{};
 const saveBaselines=()=>{if(creditScope)creditAccounts[creditScope]=creditBaselines;if(preferencesFile)atomicJSON(preferencesFile,{...preferences,accounts,creditScope,creditAccounts,creditBaselines});};
 function state(){return {accounts:Object.entries(accounts).map(([scope,value])=>({...value,scope,current:scope===creditScope,creditBaselines:creditAccounts[scope]??{}})).sort((a,b)=>Number(b.current)-Number(a.current)||b.updatedAt-a.updatedAt),buckets,resetNotification:resetState?.scope===creditScope?resetState?.event??null:null,accountScope:creditScope,creditBaselines,updatedAt,loading:!!pending,stale:!!error||!!updatedAt&&now()-updatedAt>interval*2,error};}
 async function refresh(force=false){
  if(paused)return state();
  if(pending){await pending;return state();}if(checkedAt&&now()-checkedAt<(force?10000:interval))return state();checkedAt=now();
  pending=(async()=>{try{
    const response=await read(),observed=normalizeQuota(response),observedAt=now();let resetScope=null;
    if(onObservation)try{const scope=await onObservation({buckets:observed,at:observedAt,account:response.account??null});if(typeof scope==='string')resetScope=scope;if(typeof scope==='string'&&scope!==creditScope){creditScope=scope;creditBaselines=creditAccounts[scope]??{};}}catch{/* History failure does not hide current quota. */}
    const next={...creditBaselines};for(const bucket of observed)if(!['__proto__','constructor','prototype'].includes(bucket.id))next[bucket.id]=observeCreditBalance(next[bucket.id],bucket.creditBalance);
    if(JSON.stringify(next)!==JSON.stringify(creditBaselines)){creditBaselines=next;saveBaselines();}
    try{const nextReset=observeQuotaResets(resetState,{buckets:observed,scope:resetScope,at:observedAt});if(nextReset!==resetState){resetState=nextReset;if(resetFile)atomicJSON(resetFile,resetState);}}catch{/* Notification persistence must not hide quota. */}
    buckets=observed;updatedAt=observedAt;error=buckets.length?null:'当前账户暂无额度数据';
    if(resetScope&&resetScope!=='unidentified'&&buckets.length){accounts[resetScope]={label:response.account?.email||response.account?.id||resetScope.slice(-8),buckets,updatedAt};saveBaselines();}
  }catch{error='暂时无法读取额度';}return state();})().finally(()=>{pending=null;});
  await pending;return state();
 }
 function resetCredits(id,legacy=null){
  const bucket=buckets.find(b=>b.id===id);
  if(!bucket||['__proto__','constructor','prototype'].includes(id)||state().stale||pending||bucket.unlimitedCredits||bucket.creditBalance==null)throw Error('请先刷新有效的 Credits 余额');
  const originKey=(creditScope??'unidentified')+':'+id;preferences.creditSources??={};
  if(legacy){if(preferences.creditSources[originKey]||!Number.isFinite(legacy.last)||legacy.last!==Number(bucket.creditBalance)||!Number.isFinite(legacy.baseline)||legacy.baseline<legacy.last)return state();creditBaselines={...creditBaselines,[id]:{last:legacy.last,baseline:legacy.baseline}};preferences.creditSources[originKey]='legacy';}
  else{creditBaselines={...creditBaselines,[id]:observeCreditBalance(null,bucket.creditBalance)};preferences.creditSources[originKey]='manual';}
  saveBaselines();return state();
 }
 function removeAccounts(scopes){for(const scope of scopes){delete accounts[scope];delete creditAccounts[scope];for(const key of Object.keys(preferences.creditSources??{}))if(key.startsWith(scope+':'))delete preferences.creditSources[key];}if(scopes.includes(creditScope)){creditBaselines={};buckets=[];updatedAt=null;}if(scopes.includes(resetState?.scope)){resetState=null;if(resetFile)atomicJSON(resetFile,null);}saveBaselines();}
 return {state,refresh,resetCredits,removeAccounts,async suspend(){paused=true;await pending;return ()=>{paused=false;};},invalidate(){buckets=[];updatedAt=null;checkedAt=0;creditScope=null;creditBaselines={};error=null;saveBaselines();}};
}
