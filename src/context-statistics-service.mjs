import {Worker} from 'node:worker_threads';
import {codexHome} from './paths.mjs';

export function createContextStatisticsService(home=codexHome){
  const cache=new Map(),pending=new Map();
  return async(id,refresh=false)=>{
    if(!/^[a-f\d-]{36}$/i.test(id))throw new Error('聊天 ID 无效');
    const found=cache.get(id);if(!refresh&&found&&Date.now()-found.at<10000)return found.data;
    if(pending.has(id))return pending.get(id);
    if(pending.size>=2)throw new Error('正在统计其他聊天，请稍后刷新');
    const task=new Promise((resolve,reject)=>{
      const worker=new Worker(new URL('./context-statistics-worker.mjs',import.meta.url),{workerData:{id,home},resourceLimits:{maxOldGenerationSizeMb:384},execArgv:[]});
      let finished=false;
      const done=(error,result)=>{if(finished)return;finished=true;clearTimeout(timer);void worker.terminate();error?reject(error):resolve(result);};
      const timer=setTimeout(()=>done(new Error('统计耗时过长，请稍后刷新')),25000);
      worker.once('message',message=>done(message.error?new Error(message.error):null,message.result));
      worker.once('error',()=>done(new Error('统计进程无法完成，请刷新重试')));
      worker.once('exit',()=>{if(!finished)done(new Error('统计进程已退出，请重试'));});
    }).then(data=>{cache.delete(id);cache.set(id,{data,at:Date.now()});if(cache.size>12)cache.delete(cache.keys().next().value);return data;}).finally(()=>pending.delete(id));
    pending.set(id,task);return task;
  };
}
