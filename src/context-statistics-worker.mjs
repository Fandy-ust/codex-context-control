import {parentPort,workerData} from 'node:worker_threads';
import {analyzeContext} from './context-statistics.mjs';
try{parentPort.postMessage({result:analyzeContext(workerData.home,workerData.id)});}
catch(error){parentPort.postMessage({error:error.message});}
