import crypto from 'node:crypto';
const DAY=86400000;
const str=(v,n=240)=>typeof v==='string'&&v.length>0&&v.length<=n&&!/[\x00-\x1f]/.test(v);
const count=v=>Number.isSafeInteger(v)&&v>=0;
// Explicit allowlist: never transmit titles, paths, prompts, or raw log entries.
export function numericRecords(value,now=Date.now(),{retainExpired=false}={}){
  if(!value||value.version!==1||!Array.isArray(value.requests)||!Array.isArray(value.snapshots)||value.requests.length>2000||value.snapshots.length>2000)throw Error('Invalid sync records');
  const at=v=>Number.isSafeInteger(v)&&v>=0&&(retainExpired||v>=now-366*DAY)&&v<=now+60000;
  const requests=value.requests.filter(r=>at(r.at)).map(r=>{
    if(!str(r.id)||!count(r.input)||!count(r.output)||r.model!=null&&!str(r.model,160)||r.cached!=null&&(!count(r.cached)||r.cached>r.input)||r.written!=null&&!count(r.written))throw Error('Invalid synced request');
    return {id:r.id,at:r.at,model:r.model??null,input:r.input,output:r.output,cached:r.cached??null,written:r.written??null};
  });
  const snapshots=value.snapshots.filter(r=>at(r.at)).map(r=>{
    if(!str(r.bucket,160))throw Error('Invalid synced quota bucket');
    const result={at:r.at,bucket:r.bucket};
    for(const role of ['five','weekly']){
      const used=r[role+'Used'],reset=r[role+'Reset'];
      if(used!=null&&(!Number.isFinite(used)||used<0||used>100)||reset!=null&&(!count(reset)||reset===0))throw Error('Invalid synced quota');
      result[role+'Used']=used??null;result[role+'Reset']=reset??null;
    }
    if(r.credits!=null&&(!Number.isFinite(r.credits)||r.credits<0))throw Error('Invalid synced credits');
    result.credits=r.credits??null;return result;
  });
  return {version:1,requests,snapshots};
}
export const digest=value=>crypto.createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
export function mergeRequests(local,remote){
  const map=new Map();
  for(const r of [...local,...remote]){
    const old=map.get(r.id);
    // A richer record wins; ties have a device/order-independent resolution.
    const rank=v=>[Number(v.written!=null)+Number(v.cached!=null)+Number(v.model!=null),digest([v.at,v.model,v.input,v.output,v.cached,v.written])];
    if(!old||rank(r)[0]>rank(old)[0]||rank(r)[0]===rank(old)[0]&&rank(r)[1]>rank(old)[1])map.set(r.id,r);
  }
  return [...map.values()].sort((a,b)=>a.at-b.at||a.id.localeCompare(b.id));
}
export function partitionRecords(records){
  const months=new Map();
  for(const kind of ['requests','snapshots'])for(const record of records[kind]){
    const month=new Date(record.at).toISOString().slice(0,7);
    if(!months.has(month))months.set(month,{requests:[],snapshots:[]});months.get(month)[kind].push(record);
  }
  const result=new Map();
  for(const [month,data] of [...months].sort()){
    for(const kind of ['requests','snapshots']){
      data[kind].sort((a,b)=>a.at-b.at||JSON.stringify(a).localeCompare(JSON.stringify(b)));
      for(let i=0;i<data[kind].length;i+=2000)result.set(`${month}-${kind}-${String(i/2000).padStart(4,'0')}.json`,{version:1,requests:[],snapshots:[],[kind]:data[kind].slice(i,i+2000)});
    }
  }
  return result;
}
