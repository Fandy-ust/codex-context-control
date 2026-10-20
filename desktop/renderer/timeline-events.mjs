import {timelineX} from '../../src/timeline-scale.mjs';
import {timelineSettingValue} from '../../src/presentation/timeline-settings.mjs';

export function timelineEvents(data,{e,t}){
 const lanes=[['user_input','用户输入','User input','#79c890'],['final','最终回复','Final reply','#6899ff'],['compaction','压缩','Compaction','#b488e5'],['model','切换模型','Model change','#e9b76f'],['effort','切换思考额度','Reasoning effort change','#70cfce']];
 const markers=data.buckets.flatMap(bucket=>lanes.flatMap(([type,zh,en],lane)=>{
  const changes=bucket.settingsChanges.filter(change=>change.field===type);
  const count=type==='user_input'?bucket.users:type==='final'?bucket.finals:type==='compaction'?bucket.compactions:changes.length;
  if(!count)return [];
  const description=changes.length?changes.map(change=>`#${change.responseIndex} ${timelineSettingValue(type,change.from)} → ${timelineSettingValue(type,change.to)}`).join('; '):String(count);
  // Never let adjacent bucket glyphs touch, even in a narrow window.
  const previous=data.buckets[bucket.id-1],next=data.buckets[bucket.id+1];
  const x=timelineX(bucket.position,data.upperBound,100);
  const gap=Math.min(previous?x-timelineX(previous.position,data.upperBound,100):100,next?timelineX(next.position,data.upperBound,100)-x:100);
  return `<i class="event-marker ${type}" data-bucket="${bucket.id}" style="left:${x}%;top:${6+lane*13}px;width:min(5px,${gap*.65}%)" title="${e(t(zh,en)+' · '+description)}"></i>`;
 })).join('');
 return `<div class="plot events-plot" data-plot="events">${markers}<i class="chart-cursor"></i></div><div class="chart-label chart-legend event-legend">${lanes.map(([,zh,en,color])=>`<span style="color:${color}">● ${e(t(zh,en))}</span>`).join('')}</div>`;
}
