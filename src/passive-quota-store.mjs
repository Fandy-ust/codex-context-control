import path from 'node:path';
import {readJSON,atomicJSON} from './paths.mjs';

export function createPassiveQuotaStore({home,now=Date.now}={}){
 const file=path.join(home,'passive-quota.json');
 let value;try{value=readJSON(file,null);}catch{value=null;}
 return {
  observe(next){
   if(next?.account?.type!=='chatgpt'||![next.account.id,next.account.email].some(v=>typeof v==='string'&&v.length>0&&v.length<=320)||!next.rateLimitsByLimitId||typeof next.rateLimitsByLimitId!=='object'||Array.isArray(next.rateLimitsByLimitId)||!Number.isFinite(next.observedAt)||next.observedAt<=0||next.observedAt>now()+5000)return false;
   if(value?.observedAt>next.observedAt)return false;
   // Persist only account labels and quota fields, never arbitrary RPC results.
   const account=Object.fromEntries(['type','id','email','planType'].filter(k=>typeof next.account[k]==='string').map(k=>[k,next.account[k]]));
   const rateLimitsByLimitId=Object.fromEntries(Object.entries(next.rateLimitsByLimitId).filter(([k,v])=>k.length<=160&&v&&typeof v==='object').slice(0,64).map(([k,v])=>[k,{...Object.fromEntries(['limitId','limitName','planType'].filter(f=>typeof v[f]==='string').map(f=>[f,v[f]])),...Object.fromEntries(['primary','secondary'].filter(f=>v[f]&&typeof v[f]==='object').map(f=>[f,Object.fromEntries(['usedPercent','windowDurationMins','resetsAt'].filter(n=>Number.isFinite(v[f][n])).map(n=>[n,v[f][n]]))])),...(v.credits&&typeof v.credits==='object'?{credits:Object.fromEntries(['hasCredits','unlimited','balance'].filter(f=>['boolean','number','string'].includes(typeof v.credits[f])).map(f=>[f,v.credits[f]]))}:{})}]));
   value={account,rateLimitsByLimitId,observedAt:next.observedAt};atomicJSON(file,value);return true;
  },
  read(){if(!value)throw Error('等待 ChatGPT 同步额度');return structuredClone(value);},
  invalidate(){value=null;atomicJSON(file,null);}
 };
}
