import {parentPort, workerData} from 'node:worker_threads';
import path from 'node:path';
import {activationRecommendation} from '../core/quota-activation.mjs';
import {readJSON} from '../paths.mjs';
import {QuotaLedger} from './ledger.mjs';
import {buildQuotaAnalytics} from '../core/quota-analytics.mjs';
import {estimateResponseWithWrites} from '../cost-estimate.mjs';
const ledger = new QuotaLedger(workerData);
const savedSync=readJSON(path.join(path.dirname(workerData.file),'cloud-sync.json'));
if(savedSync){
  const binding=ledger.metadata('cloudBinding'),accounts=savedSync.accounts?.length?savedSync.accounts:binding?[{id:binding.account,scopes:[binding.scope]}]:[];
  ledger.syncSettings({statisticsMode:'current',includeUnassigned:false,excludedAccounts:[],excludedDevices:[],...savedSync,accounts});
}
let lastScan = 0;
parentPort.on('message', ({id, action, params = {}}) => {
  try {
    let result;
    if (action === 'close') {ledger.close();parentPort.close();return;}
    if (action === 'record') ledger.recordLive(params);
    else if (action === 'scan') {result = ledger.scan();lastScan = Date.now();}
    else if (action === 'sync-export') result=ledger.syncExport(params);
    else if (action === 'sync-import') result=ledger.syncImport(params);
    else if (action === 'sync-profiles') result=ledger.syncProfiles();
    else if (action === 'delete-account') result=ledger.deleteAccount(params);
    else if (action === 'sync-settings') result=ledger.syncSettings(params);
    else if (action === 'activation-recommendation') {const currentScope=ledger.metadata('currentScope');result=activationRecommendation({...ledger.localRead(Date.now()-21*86400000),currentScope});}
    else if (action === 'report') {
      if (params.refresh || Date.now() - lastScan > 15000) {ledger.scan();lastScan = Date.now();}
      const source=ledger.read(366);
      source.requests=source.requests.map(r=>({...r,usd:estimateResponseWithWrites({config:{model:r.model},inputTokens:r.input,outputTokens:r.output,cachedInputTokens:r.cached,cacheWriteTokens:r.written??0},'standard').usd}));
      result = buildQuotaAnalytics(source, params);
    } else throw Error('Unknown analytics operation');
    parentPort.postMessage({id, result});
  } catch (error) {parentPort.postMessage({id, error: error.message});}
});
