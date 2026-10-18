import {parentPort, workerData} from 'node:worker_threads';
import {QuotaLedger} from './ledger.mjs';
import {buildQuotaAnalytics} from '../core/quota-analytics.mjs';
const ledger = new QuotaLedger(workerData);
let lastScan = 0;
parentPort.on('message', ({id, action, params = {}}) => {
  try {
    let result;
    if (action === 'record') ledger.recordLive(params);
    else if (action === 'scan') {result = ledger.scan();lastScan = Date.now();}
    else if (action === 'report') {
      if (params.refresh || Date.now() - lastScan > 15000) {ledger.scan();lastScan = Date.now();}
      result = buildQuotaAnalytics(ledger.read(params.days), params);
    } else throw Error('Unknown analytics operation');
    parentPort.postMessage({id, result});
  } catch (error) {parentPort.postMessage({id, error: error.message});}
});
