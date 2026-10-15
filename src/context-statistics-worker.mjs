import {parentPort,workerData} from 'node:worker_threads';
import {performance} from 'node:perf_hooks';
import {readHistory,createHistoryCache,analyzeEvents,tokenCacheStats} from './context-statistics.mjs';
const history=createHistoryCache(),results=new Map();
parentPort.on('message',({taskId,id,refresh})=>{
  const start=performance.now();let resultCacheHit=false,resultUnchanged=false;
  try {
    if(refresh)history.files.clear();
    const events=readHistory(workerData.home,id,history),previous=results.get(id);
    let result;
    if(previous?.revision===events.revision){result=previous.result;resultCacheHit=true;}
    else {
      const candidate=analyzeEvents(events,id),{generatedAt,...content}=candidate,fingerprint=JSON.stringify(content);
      resultUnchanged=previous?.fingerprint===fingerprint;result=resultUnchanged?previous.result:candidate;
      results.delete(id);results.set(id,{revision:events.revision,result,fingerprint});if(results.size>12)results.delete(results.keys().next().value);
    }
    parentPort.postMessage({taskId,result,diagnostics:{ms:performance.now()-start,resultCacheHit,resultUnchanged,history:{...history.metrics},tokens:tokenCacheStats()}});
  }catch(error){parentPort.postMessage({taskId,error:error.message});}
});
