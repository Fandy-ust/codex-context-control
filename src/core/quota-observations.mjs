const validReset=value=>Number.isSafeInteger(value)&&value>0&&value<8640000000000;

// SDKs can reconstruct an absolute reset from a relative countdown. A few
// seconds of rounding must not split a quota cycle. Bound clusters by their
// full range, not transitive proximity; preserve raw stored observations.
export function normalizeQuotaCycles(snapshots,{toleranceSeconds=60}={}){
 const groups=new Map(),translations=new Map();
 for(const p of snapshots)for(const role of ['weekly','five']){
  const value=p[role+'Reset'];if(!validReset(value))continue;
  const key=JSON.stringify([p.scope,p.bucket,role]);if(!groups.has(key))groups.set(key,new Map());
  const counts=groups.get(key);counts.set(value,(counts.get(value)||0)+1);
 }
 for(const [key,counts]of groups){
  let cluster=[];
  const commit=()=>{if(!cluster.length)return;const canonical=[...cluster].sort((a,b)=>counts.get(b)-counts.get(a)||a-b)[0];for(const value of cluster)translations.set(key+':'+value,canonical);cluster=[];};
  for(const value of [...counts.keys()].sort((a,b)=>a-b)){if(cluster.length&&value-cluster[0]>toleranceSeconds)commit();cluster.push(value);}commit();
 }
 let adjusted=0;
 const result=snapshots.map(p=>{let next=p;for(const role of ['weekly','five']){
  const value=translations.get(JSON.stringify([p.scope,p.bucket,role])+':'+p[role+'Reset']);
  if(value!=null&&value!==p[role+'Reset']){if(next===p)next={...p};next[role+'Reset']=value;adjusted++;}
 }return next;});
 return {snapshots:result,adjusted};
}
