export function selectedQuota(quota,id){return quota?.buckets?.find(bucket=>bucket.id===id)||quota?.buckets?.[0]||null;}
export function quotaWindows(bucket){return [bucket?.primary,bucket?.secondary].filter(window=>window&&Number.isFinite(window.remainingPercent)).sort((a,b)=>(a.windowDurationMins??Infinity)-(b.windowDurationMins??Infinity));}
export function quotaRemaining(bucket){const windows=quotaWindows(bucket);return windows.length?Math.max(0,Math.min(100,Math.min(...windows.map(window=>window.remainingPercent)))):null;}
export function quotaStale(quota,available=true){return !available||quota?.stale!==false;}
export function quotaLevel(remaining){return !Number.isFinite(remaining)?'':remaining<5?'critical':remaining<20?'warning':'';}
export function quotaCountdown(resetsAt,t,now=Date.now(),compact=false){
 if(!Number.isFinite(resetsAt)||resetsAt<=0)return t('重置时间暂不可用','Reset time unavailable');
 const seconds=Math.max(0,Math.ceil(resetsAt-now/1000));
 if(!seconds)return t('等待额度刷新','Waiting for quota refresh');
 const days=Math.floor(seconds/86400),hours=Math.floor(seconds%86400/3600),minutes=Math.floor(seconds%3600/60),rest=seconds%60;
 if(compact)return days?`${days}d${hours}h`:hours?`${hours}h${minutes}m`:`${minutes}m${rest}s`;
 return days?t('还剩 {0}天 {1}小时','In {0}d {1}h',days,hours):hours?t('还剩 {0}小时 {1}分','In {0}h {1}m',hours,minutes):t('还剩 {0}分 {1}秒','In {0}m {1}s',minutes,rest);
}
