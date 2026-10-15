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
  return {usd,reason:null,tier,contextBand:band,breakdown};
}
export function estimateConversation(responses){
  let usd=0,priced=0,unknownTier=0,unknownModel=0,unknownUsage=0,unsupportedRate=0,standardUSD=0,fastUSD=0,comparisonCount=0,longContextCount=0,unverifiedWriteRequests=0;
  const groups=new Map(),seen=new Set(),breakdown=Object.entries(bucketLabels).map(([category,label])=>({category,label,tokens:0,usd:0}));
  for(const response of responses){
    if(seen.has(response.id))continue;seen.add(response.id);
    const cost=estimateResponse(response);response.costEstimate=cost;
    if(cost.usd!=null){
      for(let i=0;i<breakdown.length;i++){breakdown[i].tokens+=cost.breakdown[i].tokens;breakdown[i].usd+=cost.breakdown[i].usd;}
      if(response.cacheWriteTokens===0)unverifiedWriteRequests++;
      usd+=cost.usd;priced++;if(cost.contextBand==='long')longContextCount++;
      const key=`${response.config.model}:${cost.tier}`;
      const group=groups.get(key)??{model:response.config.model,tier:cost.tier,requests:0,usd:0};
      group.requests++;group.usd+=cost.usd;groups.set(key,group);
    }else if(cost.reason==='unknown_tier')unknownTier++;
    else if(cost.reason==='unknown_model')unknownModel++;
    else if(cost.reason==='unknown_usage')unknownUsage++;
    else unsupportedRate++;
    const standard=estimateResponse(response,'standard'),fast=estimateResponse(response,'fast');
    if(standard.usd!=null&&fast.usd!=null){standardUSD+=standard.usd;fastUSD+=fast.usd;comparisonCount++;}
  }
  return {currency:'USD',checkedAt:priceBook.checkedAt,source:priceBook.source,scope:'own_thread',basis:'configured_tier',
    usd:priced>0?usd:null,pricedRequests:priced,totalRequests:seen.size,unpricedRequests:seen.size-priced,
    unknownTier,unknownModel,unknownUsage,unsupportedRate,longContextCount,unverifiedWriteRequests,
    standardUSD:comparisonCount>0?standardUSD:null,fastUSD:comparisonCount>0?fastUSD:null,comparisonRequests:comparisonCount,
    breakdown,groups:[...groups.values()]};
}
