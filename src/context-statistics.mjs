import {createHash} from 'node:crypto';
import {readHistory} from './context-history.mjs';
export {readHistory,createHistoryCache} from './context-history.mjs';
import {Tiktoken} from 'js-tiktoken/lite';
import ranks from 'js-tiktoken/ranks/o200k_base';
import {estimateConversation} from './cost-estimate.mjs';

const labels={tool_calls:'工具调用（参数／代码）',tool_results:'工具返回',user:'用户消息',assistant_final:'Agent 最终回复',assistant_commentary:'Agent 进度说明',instructions:'指令、环境与文本摘要',reasoning:'推理项目',compaction:'不透明压缩项目',other:'其他不透明项目'};
let encoder;
const tokenCounts=new Map(),tokenMetrics={hits:0,misses:0};
export const tokenCacheStats=()=>({...tokenMetrics,entries:tokenCounts.size});
const tokens=text=>{
  if(!text)return 0;
  const key=createHash('sha256').update(text).digest('hex');
  if(tokenCounts.has(key)){tokenMetrics.hits++;return tokenCounts.get(key);}
  const count=(encoder??=new Tiktoken(ranks)).encode(text,[],[]).length;
  tokenMetrics.misses++;tokenCounts.set(key,count);if(tokenCounts.size>20000)tokenCounts.delete(tokenCounts.keys().next().value);
  return count;
};
const generated=p=>p.type==='reasoning'||['function_call','custom_tool_call'].includes(p.type)||(p.type==='message'&&p.role==='assistant');

// Each usage record closes a model response. Preserve the history BEFORE its
// first generated item, excluding that response and subsequent tool results.
export function selectRequestSnapshot(events,id){
  let history=[],indices=new Map(),base='',model=null,summary='',pending=null,latest=null,compactions=0,reasoningGenerated=0,responseCount=0;
  const usageIds=new Set();
  const snapshot=()=>({history:history.slice(),base,model,summary,compactions,reasoningGenerated,responseCount});
  const append=p=>{if(p.id&&indices.has(p.id))history[indices.get(p.id)]=p;else{if(p.id)indices.set(p.id,history.length);history.push(p);}};
  for(const e of events){
    const p=e.payload??{};
    if(e.type==='session_meta'&&p.base_instructions?.text)base=p.base_instructions.text;
    if(e.type==='turn_context')model=p.model??model;
    if(e.type==='event_msg'&&['thread_rolled_back','thread_rollback'].includes(p.type))throw new Error('这段历史包含回退，暂不猜测保留范围');
    if(e.type==='compacted'){
      if(!Array.isArray(p.replacement_history))throw new Error('压缩记录缺少保留历史，无法可靠统计');
      history=[];indices=new Map();for(const item of p.replacement_history)append(item);
      summary=p.message??'';pending=null;latest=null;compactions++;reasoningGenerated=0;responseCount=0;usageIds.clear();
    }else if(e.type==='response_item'){
      if(generated(p)&&!pending)pending={...snapshot(),timestamp:e.timestamp};
      append(p);
    }else if(e.type==='token_usage_record'){
      const duplicate=p.response_id&&usageIds.has(p.response_id);
      if(!duplicate){
        if(pending&&e.originThreadId===id)latest={...pending,usage:p.usage,usageTimestamp:e.timestamp,snapshotKind:'last_request'};
        reasoningGenerated+=p.usage?.reasoning_output_tokens??0;responseCount++;
        if(p.response_id)usageIds.add(p.response_id);
      }
      pending=null;
    }
  }
  return latest??{...snapshot(),timestamp:events.at(-1)?.timestamp??null,usage:null,snapshotKind:'local_history'};
}

function content(value){
  if(typeof value==='string')return {text:value,images:0};
  const texts=[];let images=0;
  for(const part of Array.isArray(value)?value:[]){
    if(['image','input_image','image_url'].includes(part?.type))images++;
    else if(typeof part?.text==='string')texts.push(part.text);
  }
  return {text:texts.join('\n'),images};
}
function isInjectedUserMessage(p,text){
  const kinds=p.internal_chat_message_metadata_passthrough?.content_item_kinds??[];
  return kinds.includes('compaction.summary')||(kinds.length>0&&kinds.every(k=>!k.startsWith('user.')))||/^\s*<(environment_context|external_codex_apps_open_page)>/.test(text);
}
export function summarizeSnapshot(snapshot,id,countTokens=tokens){
  const rows=Object.fromEntries(Object.entries(labels).map(([category,label])=>[category,{category,label,items:0,tokensEstimate:0,images:0,opaqueItems:0}]));
  const toolCalls=new Map();let plaintextSummaryItems=0;
  for(const p of snapshot.history){
    let category='other',text='',images=0,opaque=false;
    if(p.type==='message'){
      ({text,images}=content(p.content));const kinds=p.internal_chat_message_metadata_passthrough?.content_item_kinds??[];
      const summary=kinds.includes('compaction.summary')||Boolean(snapshot.summary&&text===snapshot.summary);
      if(summary)plaintextSummaryItems++;
      const injected=summary||isInjectedUserMessage(p,text);
      if(summary||['system','developer'].includes(p.role))category='instructions';
      else if(p.role==='user')category=injected?'instructions':'user';
      else if(p.role==='assistant')category=['final','final_answer'].includes(p.phase??p.channel)?'assistant_final':'assistant_commentary';
    }else if(['function_call','custom_tool_call'].includes(p.type)){
      category='tool_calls';const name=(p.namespace?p.namespace+'.':'')+(p.name??'unknown');toolCalls.set(name,(toolCalls.get(name)??0)+1);text=name+'\n'+(p.arguments??p.input??'');
    }else if(['function_call_output','custom_tool_call_output'].includes(p.type)){category='tool_results';({text,images}=content(p.output));}
    else if(p.type==='reasoning'){category='reasoning';opaque=true;}
    else if(['compaction','compaction_summary','context_compaction'].includes(p.type)){category='compaction';opaque=true;}
    else opaque=true;
    const row=rows[category];row.items++;row.images+=images;row.opaqueItems+=Number(opaque);if(!opaque)row.tokensEstimate+=countTokens(text);
  }
  if(snapshot.base){rows.instructions.items++;rows.instructions.tokensEstimate+=countTokens(snapshot.base);}
  const categories=Object.values(rows),visibleTokens=categories.reduce((n,r)=>n+r.tokensEstimate,0),input=snapshot.usage?.input_tokens;
  const inputTokens=Number.isSafeInteger(input)&&input>=0?input:null;
  const difference=inputTokens!=null?inputTokens-visibleTokens:null;
  const residual=difference!=null&&difference>=0?difference:null;
  return {schemaVersion:1,threadId:id,generatedAt:new Date().toISOString(),snapshotAt:snapshot.timestamp,usageTimestamp:snapshot.usageTimestamp??null,
    snapshotKind:snapshot.snapshotKind,model:snapshot.model,inputTokens,visibleTokens,
    cachedInputTokens:snapshot.usage?.cached_input_tokens??null,cacheWriteTokens:snapshot.usage?.cache_write_input_tokens??null,
    unclassified:{tokensEstimate:residual,status:difference==null?'unaligned':difference<0?'estimate_exceeds_input':'estimated',opaqueItems:categories.reduce((n,r)=>n+r.opaqueItems,0),images:categories.reduce((n,r)=>n+r.images,0),reasoningItems:rows.reasoning.items,compactionItems:rows.compaction.items},
    categories:categories.filter(r=>!['reasoning','compaction','other'].includes(r.category)),toolCalls:[...toolCalls].map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count),
    reasoningGenerated:snapshot.reasoningGenerated,sampledResponses:snapshot.responseCount,compactionCount:snapshot.compactions,plaintextSummaryItems,
    tokenizer:'o200k_base · 可见文本估算',
    notes:['展示最近一次已记录请求开始前的保留历史；新生成的内容会在后续请求快照中出现。','其他／未分项是输入总量减去文本估算，包含推理、图片、工具定义、格式及估算误差，并非实测的思维链大小。','明文压缩摘要并入文本，只计一次；不透明压缩项目已合并到其他。','工具次数按模型可见的外层调用计数；消息数与其附带图片数不能直接相加。']};
}
// Only scalar configuration and numeric usage leave the reader; never message bodies.
export function buildTimeline(events,id,countTokens=tokens){
  const points=[],timelineEvents=[],seen=new Set(),timings=new Map(),inputIds=new Set(),compactionIds=new Set(),compressionResponses=new Set(),progressedTurns=new Set(),inputTurns=new Set();
  let config={},pending=[],pendingConfig=null,window=null,previousCache=null,segment=0,position=0,currentTurn=null,inputBoundaries=[],cacheSegment=0,inputSegment=0;
  const markCompression=point=>{point.eventType='compaction';point.kind='压缩响应';};
  const scalar=(value)=>typeof value==='string'||typeof value==='number'?value:null;
  const number=value=>Number.isSafeInteger(value)&&value>=0?value:null;
  for(const e of events){
    if(e.originThreadId!==id)continue;
    const p=e.payload??{};
    if(e.type==='turn_context'){
      currentTurn=p.turn_id??currentTurn;
      config={model:scalar(p.model),effort:scalar(p.effort??p.reasoning_effort),serviceTier:Object.hasOwn(p,'service_tier')?scalar(p.service_tier):config.serviceTier??null,
        contextWindow:window,compactThreshold:null};
    }
    if(e.type==='event_msg'&&p.type==='thread_settings_applied'){
      const settings=p.thread_settings??{};
      config={...config,model:scalar(settings.model)??config.model,effort:scalar(settings.reasoning_effort)??config.effort,
        serviceTier:Object.hasOwn(settings,'service_tier')?scalar(settings.service_tier):config.serviceTier};
    }
    if(e.type==='event_msg'&&p.type==='task_started'){currentTurn=p.turn_id??currentTurn;window=number(p.model_context_window);config.contextWindow=window;}
    if(e.type==='event_msg'&&p.type==='token_count'){
      window=number(p.info?.model_context_window)??window;config.contextWindow=window;
    }
    if(e.type==='event_msg'&&p.type==='item_completed'&&['Reasoning','AgentMessage'].includes(p.item?.type)){
      if(p.item.id)timings.set(p.item.id,{start:number(p.started_at_ms),end:number(p.completed_at_ms)});
    }
    if(e.type==='response_item'&&p.type==='message'&&p.role==='user'){
      const {text,images}=content(p.content),key=p.id??`user:${e.timestamp}:${position}`;
      if(!isInjectedUserMessage(p,text)&&!inputIds.has(key)){
        inputIds.add(key);
        const turnId=p.internal_chat_message_metadata_passthrough?.turn_id??currentTurn;
        const steering=turnId!=null&&(inputTurns.has(turnId)||progressedTurns.has(turnId));
        timelineEvents.push({id:`input:${key}`,position:++position,timestamp:e.timestamp,turnId,
          eventType:steering?'steering':'user_input',kind:steering?'用户追加输入':'用户输入',
          tokensEstimate:countTokens(text),images,retainedItems:null,responseId:null});
        if(turnId)inputTurns.add(turnId);
      }
    }
    if(e.type==='response_item'&&!generated(p)){
      const at=Date.parse(e.timestamp);if(Number.isFinite(at))inputBoundaries.push(at);
    }
    if(e.type==='response_item'&&generated(p)){
      if(!pending.length)pendingConfig={...config,contextWindow:window};
      pending.push({id:p.id,type:p.type,phase:p.phase??p.channel});if(currentTurn)progressedTurns.add(currentTurn);
    }
    if(e.type==='compacted'){
      const key=p.window_id??`compaction:${e.timestamp}`;
      if(!compactionIds.has(key)){
        compactionIds.add(key);
        if(p.compaction_response_id){compressionResponses.add(p.compaction_response_id);const response=points.find(x=>x.id===p.compaction_response_id);if(response)markCompression(response);}
        timelineEvents.push({id:`compact:${key}`,position:++position,timestamp:e.timestamp,turnId:currentTurn,
          eventType:'compaction',kind:'上下文压缩完成',tokensEstimate:null,images:0,
          retainedItems:Array.isArray(p.replacement_history)?p.replacement_history.length:null,responseId:p.compaction_response_id??null});
      }
      pending=[];pendingConfig=null;inputBoundaries=[];timings.clear();segment++;
    }
    if(e.type!=='token_usage_record')continue;
    const key=p.response_id??`${e.timestamp}:${points.length}`;
    if(seen.has(key))continue;seen.add(key);
    const usage=p.usage??{},input=number(usage.input_tokens),output=number(usage.output_tokens),reportedCache=number(usage.cached_input_tokens);
    const invalidCache=input!=null&&reportedCache!=null&&reportedCache>input;
    const cached=invalidCache?null:reportedCache;
    const cacheStatus=invalidCache?'invalid':cached==null?'missing':cached===0?'zero_in_log':'recorded';
    if(cached==null)cacheSegment++;if(input==null)inputSegment++;
    const first=timings.get(pending[0]?.id),end=Date.parse(e.timestamp);
    // The first generated item must have its own runtime start timestamp. A
    // completed tool call's timestamp cannot stand in for generation start.
    const duration=first?.start!=null&&first.end>=first.start&&Number.isFinite(end)&&first.end<=end&&end>first.start ? end-first.start:null;
    const rate=duration!=null&&output!=null?output/(duration/1000):null;
    const inputBoundary=duration!=null?inputBoundaries.filter(at=>at<=first.start).at(-1):null;
    const preGenerationGapMs=inputBoundary!=null?first.start-inputBoundary:null;
    const recordToCompletionMs=inputBoundary!=null?end-inputBoundary:null;
    const final=pending.some(x=>x.phase==='final'||x.phase==='final_answer');
    const point={id:key,index:points.length+1,position:++position,eventType:final?'final':'intermediate',timestamp:e.timestamp,turnId:p.turn_id??null,
      kind:final?'最终回复':pending.length?'中间响应':'未关联响应',
      inputTokens:input,outputTokens:output,reasoningTokens:number(usage.reasoning_output_tokens),
      cachedInputTokens:cached,cacheStatus,cacheSegment,inputSegment,cacheWriteTokens:number(usage.cache_write_input_tokens),
      cacheDelta:cached!=null&&previousCache!=null?cached-previousCache:null,
      cacheHitRate:input>0&&cached!=null?cached/input:null,
      durationMs:duration,preGenerationGapMs,recordToCompletionMs,tokensPerSecond:rate,timingKind:rate!=null?'observed_generation':'unavailable',
      segment,config:pendingConfig??{...config,contextWindow:window}};
    if(compressionResponses.has(key))markCompression(point);
    points.push(point);if(p.turn_id)progressedTurns.add(p.turn_id);previousCache=cached;pending=[];pendingConfig=null;inputBoundaries=[];timings.clear();if(rate==null)segment++;
  }
  return {responses:points,timelineEvents};
}
export function responseTimeline(events,id){return buildTimeline(events,id).responses;}
export function analyzeEvents(events,id){
  const timeline=buildTimeline(events,id),cost=estimateConversation(timeline.responses);
  return {...summarizeSnapshot(selectRequestSnapshot(events,id),id),...timeline,cost};
}

export function analyzeContext(home,id){return analyzeEvents(readHistory(home,id),id);}
