import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {bundledPrices,createModelPriceUpdater,readModelPrices} from '../src/model-prices.mjs';
import {estimateResponse} from '../src/cost-estimate.mjs';
import {Bridge} from '../src/bridge.mjs';
import {openaiPriceMarkdown,parseOpenAIPrices} from '../src/openai-pricing.mjs';

const officialExample=`Prices per 1M tokens.

### Standard pricing data

| Model | Short context input | Short context output | Short context cached input | Short context 30m write | Short context 12h write | Long context input | Long context output | Long context cached input | Long context 30m write | Long context 12h write |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gpt-6.2-astra | $8 | $40 | $0.40 | $10 | $20 | $16 | $60 | $0.80 | $20 | $40 |
| gpt-6.2-sol | $2 | $10 | $0.10 | $2.50 | $5 | $4 | $15 | $0.20 | $5 | $10 |
| gpt-missing-cache | $2 | $10 | $0.1 | - | - | $4 | $15 | $0.2 | - | - |

Short context: ≤272K input tokens. Long context: >272K input tokens.
`;

test('official pricing keeps the documented column semantics and rejects a changed threshold',()=>{
  const prices=parseOpenAIPrices(officialExample,272000);
  assert.deepEqual(Object.keys(prices),['gpt-6.2-astra','gpt-6.2-sol']);
  assert.deepEqual(prices['gpt-6.2-sol'].standard,{short:[2,0.1,2.5,10],long:[4,0.2,5,15]});
  assert.equal(parseOpenAIPrices(officialExample.replaceAll('272K','300K'),272000),null);
});

test('automatic price download counts a failed attempt across restarts, but manual refresh still works',async t=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-prices-'));
  t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  let calls=0, day=18, valid=false;
  const options={home,now:()=>new Date(Date.UTC(2026,10,day,12)),fetcher:async url=>{
    assert.equal(url,openaiPriceMarkdown);
    calls++;
    return new Response(valid?officialExample:'Unexpected format');
  }};
  const first=createModelPriceUpdater(options);
  const attempt=first({automatic:true});
  assert.equal(first({automatic:true}),attempt);
  await assert.rejects(attempt,/无效/);
  const restarted=createModelPriceUpdater(options);
  assert.equal(restarted({automatic:true}),undefined);
  assert.equal(calls,1);
  assert.equal(readModelPrices(home),bundledPrices);
  valid=true;
  assert.deepEqual(await restarted(),{count:2,updatedModels:['gpt-6.2-astra']});
  assert.deepEqual(readModelPrices(home).models['gpt-6.1-sol'],bundledPrices.models['gpt-6.1-sol']);
  day++;
  assert.equal(restarted({automatic:true}),undefined);
  assert.deepEqual(await restarted({automatic:true,models:['unknown-model']}),{count:2,updatedModels:[]});
  assert.equal(restarted({automatic:true,models:['unknown-model']}),undefined);
  assert.equal(calls,3);
  const before=readModelPrices(home);
  valid=false;
  await assert.rejects(restarted(),/无效/);
  assert.deepEqual(readModelPrices(home),before);
});

test('flat pricing uses the same Standard rates on either side of the context threshold',()=>{
  const row={config:{model:'gpt-6-astra'},inputTokens:300000,cachedInputTokens:0,cacheWriteTokens:0,outputTokens:0};
  assert.equal(estimateResponse(row,'standard',bundledPrices,'api').usd,6);
  assert.equal(estimateResponse(row,'standard',bundledPrices,'flat').usd,3);
  row.inputTokens=bundledPrices.longContextAbove;
  assert.equal(estimateResponse(row,'standard',bundledPrices,'api').usd,2.72);
});

test('Codex picker refresh uses all pages and rejects a repeated cursor',async()=>{
  const model={model:'gpt-test',displayName:'Available model',supportedReasoningEfforts:[{reasoningEffort:'high'}],defaultReasoningEffort:'high'};
  const requests=[];
  const bridge={rpc:async(method,params)=>{
    requests.push({method,params});
    return params.cursor?{data:[model]}:{data:[{model:'hidden',hidden:true}],nextCursor:'second'};
  }};
  assert.deepEqual(await Bridge.prototype.listPickerModels.call(bridge),[{id:'gpt-test',name:'Available model',efforts:['high'],defaultEffort:'high'}]);
  assert.deepEqual(requests.map(({method,params})=>[method,params.cursor]),[['model/list',undefined],['model/list','second']]);
  await assert.rejects(Bridge.prototype.listPickerModels.call({rpc:async()=>({data:[],nextCursor:'same'})}),/未完整加载/);
});
