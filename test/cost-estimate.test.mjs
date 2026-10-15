import test from 'node:test';
import assert from 'node:assert/strict';
import {estimateResponse,estimateConversation,pricingTier} from '../src/cost-estimate.mjs';
import {buildTimeline} from '../src/context-statistics.mjs';
const row=(extra={})=>({id:'a',config:{model:'gpt-6-astra',serviceTier:'default'},inputTokens:100000,cachedInputTokens:80000,cacheWriteTokens:10000,outputTokens:2000,reasoningTokens:1500,...extra});
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`);
test('input, cache reads/writes partition billing; reasoning is not charged twice',()=>{
 const result=estimateResponse(row());near(result.usd,.405);
 assert.deepEqual(result.breakdown.map(x=>x.tokens),[10000,80000,10000,2000]);
 near(result.breakdown.reduce((sum,x)=>sum+x.usd,0),result.usd);
 near(estimateResponse(row({config:{model:'gpt-6-astra',serviceTier:'priority'}})).usd,.81);
 assert.equal(pricingTier('fast'),'fast');assert.equal(pricingTier(null),null);assert.equal(pricingTier('auto'),null);
 near(estimateResponse(row({reasoningTokens:0})).usd,.405);
});
test('long-context pricing uses actual input, not configured capacity, at the exact threshold',()=>{
 const base=row({inputTokens:272000,cachedInputTokens:0,cacheWriteTokens:0,outputTokens:1000,config:{model:'gpt-6-astra',serviceTier:'default',contextWindow:1000000}});
 assert.equal(estimateResponse(base).contextBand,'short');near(estimateResponse(base).usd,2.77);
 const long=estimateResponse({...base,inputTokens:272001});assert.equal(long.contextBand,'long');near(long.usd,5.51502);
});
test('unknown models, tiers, missing usage and invalid cache counts never become free requests',()=>{
 for(const input of [row({config:{model:'custom',serviceTier:'default'}}),row({config:{model:'gpt-6-astra',serviceTier:null}}),row({cachedInputTokens:null}),row({cacheWriteTokens:100000})])assert.equal(estimateResponse(input).usd,null);
 const result=estimateConversation([row(),row(),row({id:'b',config:{model:'gpt-6-astra',serviceTier:null}})]);
 near(result.usd,.405);assert.equal(result.totalRequests,2);assert.equal(result.pricedRequests,1);assert.equal(result.unknownTier,1);near(result.standardUSD,.81);near(result.fastUSD,1.62);
 assert.equal(estimateConversation([]).usd,null);
});
test('model-specific cached rates and explicit ultrafast rates are preserved',()=>{
 near(estimateResponse(row({config:{model:'gpt-6.1-sol',serviceTier:'fast'}})).usd,.146);
 near(estimateResponse(row({config:{model:'gpt-6-astra',serviceTier:'ultrafast'}})).usd,2.43);
 assert.equal(estimateResponse(row({config:{model:'gpt-6-sol',serviceTier:'ultrafast'}})).reason,'unsupported_rate');
});
test('turn settings clear stale Fast and a mid-response change does not reprice earlier output',()=>{
 const id='chat',e=(type,payload)=>({type,payload,originThreadId:id,timestamp:'2026-10-16T00:00:00Z'});
 const events=[e('turn_context',{turn_id:'turn',model:'gpt-6-astra'}),e('event_msg',{type:'thread_settings_applied',thread_settings:{service_tier:'priority'}}),e('response_item',{type:'reasoning',id:'r'}),e('event_msg',{type:'thread_settings_applied',thread_settings:{service_tier:null}}),e('token_usage_record',{response_id:'a',usage:{}}),e('response_item',{type:'reasoning',id:'r2'}),e('token_usage_record',{response_id:'b',usage:{}})];
 const result=buildTimeline(events,id).responses;assert.equal(result[0].config.serviceTier,'priority');assert.equal(result[1].config.serviceTier,null);
});

test('fee buckets add up over mixed tiers and models without using cache delta as writes',()=>{
 const a=row({cacheDelta:900000});const b=row({id:'b',config:{model:'gpt-6.1-sol',serviceTier:'fast'},cacheDelta:-999});
 const total=estimateConversation([a,b]);near(total.usd,.551);
 assert.deepEqual(total.breakdown.map(x=>x.tokens),[20000,160000,20000,4000]);
 near(total.breakdown.reduce((sum,x)=>sum+x.usd,0),total.usd);
 assert.equal(a.costEstimate.breakdown.find(x=>x.category==='cache_write').tokens,10000);
});

test('chat cost excludes inherited requests and survives compaction without duplicate charges',()=>{
 const id='own',event=(type,payload,originThreadId=id)=>({type,payload,originThreadId,timestamp:'2026-10-16T00:00:00Z'});
 const usage={input_tokens:100000,cached_input_tokens:80000,cache_write_input_tokens:10000,output_tokens:2000};
 const events=[event('token_usage_record',{response_id:'parent',usage},'parent'),event('turn_context',{model:'gpt-6-astra',service_tier:'default'}),event('token_usage_record',{response_id:'a',usage}),event('compacted',{replacement_history:[],compaction_response_id:'a',latest_token_usage_record:{response_id:'a',usage}}),event('token_usage_record',{response_id:'b',usage}),event('token_usage_record',{response_id:'a',usage})];
 const cost=estimateConversation(buildTimeline(events,id).responses);
 assert.equal(cost.totalRequests,2);assert.equal(cost.pricedRequests,2);near(cost.usd,.81);
});
