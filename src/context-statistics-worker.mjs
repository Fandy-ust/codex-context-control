import {parentPort,workerData} from 'node:worker_threads';
import {statisticsEvent} from './statistics-events.mjs';
import {randomUUID} from 'node:crypto';
import {historySourcesUnchanged} from './context-history.mjs';
import {performance} from 'node:perf_hooks';
import {readHistory,createHistoryCache,analyzeEvents,tokenCacheStats} from './context-statistics.mjs';
const history=createHistoryCache({projectEvent:statisticsEvent}),results=new Map();
parentPort.on('message',({taskId,id,refresh,knownResultKey})=>{
  const start=performance.now();let resultCacheHit=false,resultUnchanged=false;
  try {
    if(refresh)history.files.clear();
    const previous=results.get(id);
    let entry=previous;
    if(!refresh&&previous&&historySourcesUnchanged(workerData.home,previous.sources)){resultCacheHit=true;}
    else {
      const events=readHistory(workerData.home,id,history);
      if(previous?.revision===events.revision){resultCacheHit=true;entry={...previous,sources:events.sources};}
      else {
        const candidate=analyzeEvents(events,id),{generatedAt,...content}=candidate,fingerprint=JSON.stringify(content);
        resultUnchanged=previous?.fingerprint===fingerprint;
        entry={revision:events.revision,sources:events.sources,result:resultUnchanged?previous.result:candidate,
          fingerprint,key:resultUnchanged?previous.key:randomUUID()};
      }
    }
    results.delete(id);results.set(id,entry);if(results.size>12)results.delete(results.keys().next().value);
    const resultReused=knownResultKey===entry.key;
    parentPort.postMessage({taskId,resultKey:entry.key,...(resultReused?{resultReused:true}:{result:entry.result}),diagnostics:{ms:performance.now()-start,resultCacheHit,resultUnchanged,resultReused,history:{...history.metrics},tokens:tokenCacheStats()}});
  }catch(error){parentPort.postMessage({taskId,error:error.message});}
});
