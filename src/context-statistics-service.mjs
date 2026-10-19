import {Worker} from 'node:worker_threads';
import {codexHome} from './paths.mjs';

export function createContextStatisticsService(home=codexHome,{idleMs=30000,cacheMs=1000,maxWorkers=2,timeoutMs=25000}={}){
  const cache=new Map(),pending=new Map(),queue=[],slots=[];
  const workerLimit=Number.isInteger(maxWorkers)?Math.max(1,Math.min(2,maxWorkers)):2;
  let sequence=0,closed=false,workerStarts=0,lastDiagnostics=null;
  const retire=slot=>{clearTimeout(slot.idleTimer);clearTimeout(slot.timer);const i=slots.indexOf(slot);if(i>=0)slots.splice(i,1);void slot.worker.terminate();};
  const complete=(slot,error,result)=>{
    const job=slot.job;if(!job)return;slot.job=null;clearTimeout(slot.timer);
    if(error){retire(slot);job.reject(error);}
    else {slot.affinity.delete(job.id);slot.affinity.add(job.id);if(slot.affinity.size>12)slot.affinity.delete(slot.affinity.values().next().value);job.resolve(result);slot.worker.unref();slot.idleTimer=setTimeout(()=>retire(slot),idleMs);slot.idleTimer.unref();}
    dispatch();
  };
  function makeSlot(){
    const worker=new Worker(new URL('./context-statistics-worker.mjs',import.meta.url),{workerData:{home},resourceLimits:{maxOldGenerationSizeMb:384},execArgv:[]});
    const slot={worker,job:null,lastId:null,affinity:new Set()};slots.push(slot);workerStarts++;
    worker.on('message',message=>{if(message.taskId!==slot.job?.taskId)return;lastDiagnostics=message.diagnostics??null;const cached=slot.job.cached;
      const invalidReuse=message.resultReused&&(!cached||cached.key!==message.resultKey);
      complete(slot,message.error?new Error(message.error):invalidReuse?new Error('统计缓存已失效，请重试'):null,{data:message.resultReused?cached?.data:message.result,key:message.resultKey});});
    worker.on('error',()=>complete(slot,new Error('统计进程无法完成，请刷新重试')));
    worker.on('exit',()=>{clearTimeout(slot.idleTimer);if(slot.job)complete(slot,new Error('统计进程已退出，请重试'));else {const i=slots.indexOf(slot);if(i>=0)slots.splice(i,1);}});
    return slot;
  }
  function dispatch(){
    if(closed)return;
    while(queue.length){
      const next=queue[0];let slot=slots.find(s=>!s.job&&s.lastId===next.id)??slots.find(s=>!s.job&&s.affinity.has(next.id))??slots.find(s=>!s.job);
      if(!slot){if(slots.length>=workerLimit)return;try{slot=makeSlot();}catch{queue.shift().reject(new Error('无法启动统计进程'));continue;}}
      const job=queue.shift();clearTimeout(slot.idleTimer);slot.job=job;slot.lastId=job.id;slot.worker.ref();
      slot.timer=setTimeout(()=>complete(slot,new Error('统计耗时过长，请稍后刷新')),timeoutMs);
      slot.worker.postMessage({taskId:job.taskId,id:job.id,refresh:job.refresh,mode:job.mode,knownResultKey:job.cached?.key});
    }
  }
  const get=async(id,refresh=false,mode='statistics')=>{
    const cacheKey=mode+':'+id;
    if(closed)throw new Error('统计服务已关闭');
    if(!/^[a-f\d-]{36}$/i.test(id))throw new Error('聊天 ID 无效');
    if(pending.has(cacheKey))return pending.get(cacheKey);
    const found=cache.get(cacheKey);if(!refresh&&found&&Date.now()-found.at<cacheMs)return found.data;
    if(pending.size>=8)throw new Error('正在统计其他聊天，请稍后刷新');
    const task=new Promise((resolve,reject)=>{queue.push({id,refresh,mode,cached:found,taskId:++sequence,resolve,reject});dispatch();})
      .then(({data,key})=>{cache.delete(cacheKey);cache.set(cacheKey,{data,key,at:Date.now()});if(cache.size>12)cache.delete(cache.keys().next().value);return data;})
      .finally(()=>pending.delete(cacheKey));
    pending.set(cacheKey,task);return task;
  };
  get.speed=(id,refresh=false)=>get(id,refresh,'speed');
  get.diagnostics=()=>({workerStarts,workers:slots.length,pending:pending.size,queued:queue.length,cachedResults:cache.size,last:lastDiagnostics});
  get.close=()=>{closed=true;for(const job of queue.splice(0))job.reject(new Error('统计服务已关闭'));for(const slot of [...slots]){const job=slot.job;slot.job=null;retire(slot);job?.reject(new Error('统计服务已关闭'));}cache.clear();};
  return get;
}
