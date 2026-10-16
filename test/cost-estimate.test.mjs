import test from 'node:test';
import assert from 'node:assert/strict';
import {estimateResponse,estimateResponseWithWrites,estimateConversation,pricingTier} from '../src/cost-estimate.mjs';
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
test('generic estimator rejects unknown tiers; panel base pricing does not require a runtime tier',()=>{
 for(const input of [row({config:{model:'custom',serviceTier:'default'}}),row({config:{model:'gpt-6-astra',serviceTier:null}}),row({cachedInputTokens:null}),row({cacheWriteTokens:100000})])assert.equal(estimateResponse(input).usd,null);
 const result=estimateConversation([row(),row(),row({id:'b',config:{model:'gpt-6-astra',serviceTier:null}})]);
 near(result.usd,.81);assert.equal(result.totalRequests,2);assert.equal(result.pricedRequests,2);assert.equal(result.unknownTier,0);
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
 const total=estimateConversation([a,b]);near(total.usd,.478);
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

test('normalized zero cache-write counts remain explicitly unverified',()=>{
 const cost=estimateConversation([row({cacheWriteTokens:0}),row({id:'b'})]);
 assert.equal(cost.unverifiedWriteRequests,1);
 const positive=estimateConversation([row()]);assert.equal(positive.unverifiedWriteRequests,0);
});

test('unknown physical writes give finite API-equivalent bounds without double charging input',()=>{
 const zero=estimateResponse(row({cacheWriteTokens:0}));near(zero.usd,.38);near(zero.upperUSD,.43);assert.equal(zero.extraWriteTokens,20000);
 const known=estimateResponse(row());near(known.usd,known.upperUSD);assert.equal(known.maxWriteSurcharge,0);
 const cached=estimateResponse(row({inputTokens:80000,cacheWriteTokens:0}));near(cached.usd,cached.upperUSD);
 const long=estimateResponse(row({inputTokens:300000,cachedInputTokens:200000,cacheWriteTokens:0}));near(long.maxWriteSurcharge,.5);
 const total=estimateConversation([row({cacheWriteTokens:0}),row({id:'b'})]);near(total.upperUSD,.835);near(total.maxWriteSurcharge,0);
});

test('cumulative cache reads grow with reuse without creating new-write charges',()=>{
 const responses=Array.from({length:10},(_,i)=>row({id:`read-${i}`,inputTokens:10000,cachedInputTokens:10000,cacheWriteTokens:0,outputTokens:0}));
 const cost=estimateConversation(responses);
 assert.equal(cost.breakdown.find(x=>x.category==='cache_read').tokens,100000);
 assert.equal(cost.extraWriteTokens,0);near(cost.usd,.1);near(cost.upperUSD,.1);
});

test('official input partition formula charges a written token once, not input plus full write price',()=>{
 const allWritten=estimateResponse(row({inputTokens:12000,cachedInputTokens:0,cacheWriteTokens:12000,outputTokens:0}));
 near(allWritten.usd,.15);assert.equal(allWritten.breakdown[0].tokens,0);
 const reused=estimateResponse(row({inputTokens:15000,cachedInputTokens:12000,cacheWriteTokens:3000,outputTokens:0}));
 near(reused.usd,.0495);assert.equal(reused.breakdown[0].tokens,0);
});

test('display estimate fills cache writes from uncached input and keeps all fees consistent',()=>{
 const original=row({cacheWriteTokens:0});const total=estimateConversation([original]);
 assert.equal(original.cacheWriteTokens,0);assert.equal(original.costEstimate.writeEstimated,true);
 assert.deepEqual(total.breakdown.map(x=>x.tokens),[0,80000,20000,2000]);near(total.usd,.43);
 near(total.breakdown.reduce((sum,x)=>sum+x.usd,0),total.usd);
 near(total.groups[0].usd,total.usd);
 assert.equal(estimateResponseWithWrites(row()).writeEstimated,false);
});

test('panel totals and every response use Standard rates while retaining actual Fast config',()=>{
 const responses=['default','priority','fast','ultrafast','flex',null,'auto'].map((serviceTier,i)=>row({id:String(i),config:{model:'gpt-6-astra',serviceTier,effort:'high'},cacheWriteTokens:0}));
 const configs=structuredClone(responses.map(r=>r.config));
 const total=estimateConversation(responses);
 assert.equal(total.basis,'standard_rates');near(total.usd,.43*responses.length);
 assert.equal(total.pricedRequests,responses.length);assert.equal(total.groups.length,1);
 assert.deepEqual(responses.map(r=>r.config),configs);
 for(const r of responses){near(r.costEstimate.usd,.43);assert.equal(r.costEstimate.tier,'standard');}
 near(total.breakdown.reduce((sum,p)=>sum+p.usd,0),total.usd);
 near(total.groups[0].usd,total.usd);assert.equal(total.groups[0].tier,'standard');
 assert.equal('fastUSD' in total,false);
 const long=row({id:'long',inputTokens:300000,cachedInputTokens:200000,cacheWriteTokens:0,config:{model:'gpt-6-astra',serviceTier:'priority'}});
 near(estimateConversation([long]).usd,estimateResponseWithWrites(long,'standard').usd);
 for(const unknown of [row({cachedInputTokens:null}),row({config:{model:'custom',serviceTier:'fast'}})]){
   const incomplete=estimateConversation([unknown]);assert.equal(incomplete.usd,null);assert.equal(incomplete.unpricedRequests,1);
 }
});
