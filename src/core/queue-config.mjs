export const defaultQueueConfig=()=>({pool:'codex',resume:'auto',retryEnabled:true,fiveHour:{reserve:20,stages:[]},weekly:{reserve:10,stages:[]}});
function percentage(value){if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>100)throw Error('保留比例必须在 0–100% 之间');return value;}
export function validateQueueConfig(value){
  if(!value||!['auto','manual'].includes(value.resume)||typeof value.pool!=='string'||!value.pool.length||value.pool.length>160)throw Error('队列设置无效');
  if(value.retryEnabled!==undefined&&typeof value.retryEnabled!=='boolean')throw Error('自动重试开关无效');
  const out={pool:value.pool,resume:value.resume,retryEnabled:value.retryEnabled!==false};
  for(const name of ['fiveHour','weekly']){
    const item=value[name];if(!item||!Array.isArray(item.stages)||item.stages.length>3)throw Error('每种额度最多设置三个释放梯度');
    const reserve=percentage(item.reserve);let previousMinutes=Infinity,previousReserve=reserve;
    const stages=item.stages.map(s=>{if(!Number.isInteger(s.minutes)||s.minutes<1||s.minutes>(name==='fiveHour'?300:10080)||s.minutes>=previousMinutes)throw Error('释放时间应由远到近，且不能重复');const next=percentage(s.reserve);if(next>previousReserve)throw Error('临近重置的保留比例只能降低');previousMinutes=s.minutes;previousReserve=next;return {minutes:s.minutes,reserve:next};});
    out[name]={reserve,stages};
  }return out;
}
