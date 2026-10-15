import fs from 'node:fs';
export const priceBook=JSON.parse(fs.readFileSync(new URL('./api-prices.json',import.meta.url),'utf8'));
const bucketLabels={ordinary_input:'普通输入',cache_read:'缓存读取',cache_write:'缓存写入',output:'输出'};
const integer=value=>Number.isSafeInteger(value)&&value>=0;
export function pricingTier(value){
  if(value==='priority'||value==='fast')return 'fast';
  if(value==='default'||value==='standard')return 'standard';
  if(value==='ultrafast'||value==='flex')return value;
  return null; // Unset/auto is not proof of Standard; project defaults can differ.
}
export function estimateResponse(row,overrideTier){
  const model=priceBook.models[row.config?.model];
  const tier=overrideTier??pricingTier(row.config?.serviceTier);
  const fail=reason=>({usd:null,reason,tier,contextBand:null});
  if(!model)return fail('unknown_model');
  const {inputTokens:input,cachedInputTokens:cached,cacheWriteTokens:written,outputTokens:output}=row;
  if(![input,cached,written,output].every(integer)||cached+written>input)return fail('unknown_usage');
  if(!tier)return fail('unknown_tier');
  const band=input>priceBook.longContextAbove?'long':'short';
  const rates=model[tier]?.[band];if(!rates||rates.some(n=>n==null))return fail('unsupported_rate');
  // Cache reads and writes partition input. Reasoning is already in output.
  const counts=[input-cached-written,cached,written,output];
  const breakdown=Object.entries(bucketLabels).map(([category,label],i)=>({category,label,tokens:counts[i],usd:counts[i]*rates[i]/priceBook.unitTokens}));
  const usd=breakdown.reduce((sum,part)=>sum+part.usd,0);
  // Zero in Codex usage does not measure physical cache growth. For API
  // equivalence, bound possible writes by the uncached input, never by Δcache.
  const extraWriteTokens=written===0?input-cached:0;
  const maxWriteSurcharge=extraWriteTokens*Math.max(0,rates[2]-rates[0])/priceBook.unitTokens;
  return {usd,upperUSD:usd+maxWriteSurcharge,maxWriteSurcharge,extraWriteTokens,reason:null,tier,contextBand:band,breakdown};
}
// The requested rough estimate treats uncached input as newly written when
// the runtime provides no positive write count. Preserve raw usage on the row.
export function estimateResponseWithWrites(row,tier){
  const reported=estimateResponse(row,tier);
  if(reported.usd==null)return reported;
  const writeEstimated=row.cacheWriteTokens===0&&row.inputTokens>row.cachedInputTokens;
  if(!writeEstimated)return {...reported,writeEstimated:false};
  return {...estimateResponse({...row,cacheWriteTokens:row.inputTokens-row.cachedInputTokens},tier),writeEstimated:true};
}
export function estimateConversation(responses){
  let usd=0,upperUSD=0,maxWriteSurcharge=0,extraWriteTokens=0,standardUpperUSD=0,fastUpperUSD=0,priced=0,unknownTier=0,unknownModel=0,unknownUsage=0,unsupportedRate=0,standardUSD=0,fastUSD=0,comparisonCount=0,longContextCount=0,unverifiedWriteRequests=0;
  const groups=new Map(),seen=new Set(),breakdown=Object.entries(bucketLabels).map(([category,label])=>({category,label,tokens:0,usd:0}));
  for(const response of responses){
    if(seen.has(response.id))continue;seen.add(response.id);
    const cost=estimateResponseWithWrites(response);response.costEstimate=cost;
    if(cost.usd!=null){
      for(let i=0;i<breakdown.length;i++){breakdown[i].tokens+=cost.breakdown[i].tokens;breakdown[i].usd+=cost.breakdown[i].usd;}
      if(response.cacheWriteTokens===0)unverifiedWriteRequests++;
      usd+=cost.usd;upperUSD+=cost.upperUSD;maxWriteSurcharge+=cost.maxWriteSurcharge;extraWriteTokens+=cost.extraWriteTokens;priced++;if(cost.contextBand==='long')longContextCount++;
      const key=`${response.config.model}:${cost.tier}`;
      const group=groups.get(key)??{model:response.config.model,tier:cost.tier,requests:0,usd:0};
      group.requests++;group.usd+=cost.usd;groups.set(key,group);
    }else if(cost.reason==='unknown_tier')unknownTier++;
    else if(cost.reason==='unknown_model')unknownModel++;
    else if(cost.reason==='unknown_usage')unknownUsage++;
    else unsupportedRate++;
    const standard=estimateResponseWithWrites(response,'standard'),fast=estimateResponseWithWrites(response,'fast');
    if(standard.usd!=null&&fast.usd!=null){standardUSD+=standard.usd;fastUSD+=fast.usd;standardUpperUSD+=standard.upperUSD;fastUpperUSD+=fast.upperUSD;comparisonCount++;}
  }
  return {currency:'USD',checkedAt:priceBook.checkedAt,source:priceBook.source,scope:'own_thread',basis:'configured_tier',writeEstimateMethod:'uncached_input_when_zero',
    usd:priced>0?usd:null,upperUSD:priced>0?upperUSD:null,maxWriteSurcharge,extraWriteTokens,rangeBasis:'zero_to_all_uncached_input',pricedRequests:priced,totalRequests:seen.size,unpricedRequests:seen.size-priced,
    unknownTier,unknownModel,unknownUsage,unsupportedRate,longContextCount,unverifiedWriteRequests,
    standardUSD:comparisonCount>0?standardUSD:null,fastUSD:comparisonCount>0?fastUSD:null,standardUpperUSD:comparisonCount>0?standardUpperUSD:null,fastUpperUSD:comparisonCount>0?fastUpperUSD:null,comparisonRequests:comparisonCount,
    breakdown,groups:[...groups.values()]};
}
