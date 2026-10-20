// Display aggregation shared by Web clients. Mirrors macos/TimelineData.swift;
// raw accounting remains in context-statistics.mjs.
import {timelineSettingChanges,timelineSpeedMode} from './presentation/timeline-settings.mjs';
export function timelineData(responses=[],events=[],{period=0,limit=120}={}){
  period=Math.max(0,period);limit=Math.max(1,limit);
  const entries=[...responses.map(response=>({id:response.id,position:response.position,eventType:response.eventType,response})),...events.map(event=>({id:event.id,position:event.position,eventType:event.eventType,event}))].sort((a,b)=>a.position-b.position);
  const bucketSize=Math.max(1,Math.ceil(Math.max(responses.length,events.length?1:0)/limit)),eventBinSize=Math.max(1,Math.ceil(entries.length/limit));
  const count=responses.length?Math.ceil(responses.length/bucketSize):Math.ceil(entries.length/eventBinSize);
  const bins=Array.from({length:count},()=>({start:null,end:0,responses:0,measured:0,inputSum:0,inputCount:0,cacheSum:0,cacheCount:0,cacheMinimum:null,generatedTokens:0,duration:0,output:0,outputSamples:0,finals:0,users:0,compactions:0,zeros:0,models:new Set(),settingsChanges:[],speedModes:new Set()}));
  function metric(){return {state:null,source:null,bins:Array.from({length:count},()=>({sum:0,count:0})),reset(){this.state=this.source=null;},add(value,source,bucket){if(value==null||!Number.isFinite(value)){this.reset();return;}if(this.source!==null&&this.source!==source)this.reset();this.source=source;const alpha=period<=1?1:2/(period+1);this.state=this.state==null?value:this.state+alpha*(value-this.state);this.bins[bucket].sum+=this.state;this.bins[bucket].count++;}};}
  const speed=metric(),input=metric(),cache=metric(),mapping=[],byID=new Map();let responseIndex=0,previousConfig=null,previousSettings=null;
  for(let index=0;index<entries.length;index++){
    const entry=entries[index],bucket=Math.min(count-1,responses.length?Math.floor(responseIndex/bucketSize):Math.floor(index/eventBinSize)),b=bins[bucket];
    byID.set(entry.id,index);mapping.push(bucket);b.start??=index;b.end=index+1;
    if(entry.eventType==='compaction'&&entry.event){b.compactions++;speed.reset();input.reset();cache.reset();}
    if(entry.event&&['user_input','steering'].includes(entry.eventType))b.users++;
    const r=entry.response;if(!r)continue;responseIndex++;b.responses++;b.firstResponse??=r.index;b.lastResponse=r.index;
    if(typeof r.timestamp==='string'&&Number.isFinite(Date.parse(r.timestamp))){b.firstTimestamp??=r.timestamp;b.lastTimestamp=r.timestamp;}
    if(r.eventType==='final')b.finals++;if(r.cacheStatus==='zero_in_log')b.zeros++;if(r.config?.model)b.models.add(r.config.model);
    b.settingsChanges.push(...timelineSettingChanges(previousSettings,r.config,r.index));previousSettings=r.config??{};
    const mode=timelineSpeedMode(r.config?.serviceTier);if(mode==='fast'||mode==='ultrafast')b.speedModes.add(mode);
    const config=[r.config?.model??'',r.config?.serviceTier??'',r.config?.effort??''].join('|');if(previousConfig!==null&&config!==previousConfig){speed.reset();input.reset();cache.reset();}previousConfig=config;
    if(r.inputTokens!=null){b.inputSum+=r.inputTokens;b.inputCount++;}
    if(r.cachedInputTokens!=null){b.cacheSum+=r.cachedInputTokens;b.cacheCount++;b.cacheMinimum=Math.min(b.cacheMinimum??r.cachedInputTokens,r.cachedInputTokens);}
    if(r.outputTokens!=null){b.output+=r.outputTokens;b.outputSamples++;}
    if(r.tokensPerSecond!=null&&r.durationMs>0&&r.outputTokens!=null){b.measured++;b.generatedTokens+=r.outputTokens;b.duration+=r.durationMs;}
    speed.add(r.tokensPerSecond,r.segment,bucket);input.add(r.inputTokens,r.inputSegment,bucket);cache.add(r.cachedInputTokens,r.cacheSegment,bucket);
  }
  const buckets=bins.map((b,id)=>({...b,id,position:(entries[b.start].position+entries[b.end-1].position)/2,inputMean:b.inputCount?b.inputSum/b.inputCount:null,cacheMean:b.cacheCount?b.cacheSum/b.cacheCount:null,speed:b.duration?b.generatedTokens/(b.duration/1000):null,models:[...b.models].sort(),speedModes:[...b.speedModes]}));
  const points=(metric,key)=>{let series=0;return metric.bins.flatMap((bin,id)=>{if(!bin.count){series++;return [];}const value=period<=1?buckets[id][key]:bin.sum/bin.count;if(value==null){series++;return [];}return [{id,position:buckets[id].position,value,series}];});};
  return {entries,buckets,mapping,byID,bucketSize,upperBound:Math.max(2,(entries.at(-1)?.position??0)+1),speed:points(speed,'speed'),input:points(input,'inputMean'),cache:points(cache,'cacheMean')};
}
export function nearestBucket(data,position){
  const a=data.entries;if(!a.length)return null;let low=0,high=a.length;while(low<high){const mid=(low+high)>>1;if(a[mid].position<position)low=mid+1;else high=mid;}
  const at=low===0?0:low===a.length?a.length-1:position-a[low-1].position<=a[low].position-position?low-1:low;return data.mapping[at];
}
