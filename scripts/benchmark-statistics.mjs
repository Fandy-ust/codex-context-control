import {performance} from 'node:perf_hooks';
import {createContextStatisticsService} from '../src/context-statistics-service.mjs';
const id=process.argv[2];if(!id)throw new Error('Pass the selected chat ID; no message content is printed.');
const get=createContextStatisticsService(undefined,{cacheMs:0}),samples=[];
try{
 for(const [label,refresh] of [['cold',false],['unchanged',false],['manual-refresh',true],['unchanged-again',false]]){
  const start=performance.now();const result=await get(id,refresh);
  samples.push({label,ms:Number((performance.now()-start).toFixed(2)),responses:result.responses.length,...get.diagnostics()});
 }
 console.log(JSON.stringify(samples,null,2));
}finally{get.close();}
