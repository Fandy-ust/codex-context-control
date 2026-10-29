// Observe existing client traffic only. Never send an RPC or start a runtime.
export function createQuotaObserver(publish=()=>{},now=Date.now){
 let account=null,limits={},observedAt=null;
 const identity=value=>value?.type==='chatgpt'&&[value.id,value.email].some(v=>typeof v==='string'&&v.length>0&&v.length<=320)?Object.fromEntries(['type','id','email','planType'].filter(k=>typeof value[k]==='string').map(k=>[k,value[k]])):null;
 const emit=()=>{if(!account||!observedAt||!Object.keys(limits).length)return;const value={account:{...account},rateLimitsByLimitId:structuredClone(limits),observedAt};Promise.resolve().then(()=>publish(value)).catch(()=>{});return value;};
 return {snapshot:null,observe(method,value){
  if(method==='account/updated'){account=null;limits={};observedAt=null;this.snapshot=null;Promise.resolve().then(()=>publish({invalidated:true})).catch(()=>{});return;}
  if(method==='account/read'){
   const next=identity(value?.account);
   if(!next){account=null;limits={};observedAt=null;this.snapshot=null;Promise.resolve().then(()=>publish({invalidated:true})).catch(()=>{});return;}
   if(account&&JSON.stringify(account)!==JSON.stringify(next)){limits={};observedAt=null;}
   account=next;
  }else if(method==='account/rateLimits/read'||method==='account/rateLimits/updated'){
   if(value?.rateLimitsByLimitId&&typeof value.rateLimitsByLimitId==='object'&&!Array.isArray(value.rateLimitsByLimitId))limits={...limits,...value.rateLimitsByLimitId};
   else if(value?.rateLimits&&typeof value.rateLimits==='object')limits={...limits,[value.rateLimits.limitId||'codex']:value.rateLimits};
   else return;
   observedAt=now();
  }else return;
  this.snapshot=emit()??null;
 }};
}

