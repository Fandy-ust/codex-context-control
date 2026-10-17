export function selectedQuota(quota,id){return quota?.buckets?.find(bucket=>bucket.id===id)||quota?.buckets?.[0]||null;}
export function quotaWindows(bucket){return [bucket?.primary,bucket?.secondary].filter(window=>window&&Number.isFinite(window.remainingPercent)).sort((a,b)=>(a.windowDurationMins??Infinity)-(b.windowDurationMins??Infinity));}
export function quotaRemaining(bucket){const windows=quotaWindows(bucket);return windows.length?Math.max(0,Math.min(100,Math.min(...windows.map(window=>window.remainingPercent)))):null;}
export function quotaStale(quota,available=true){return !available||quota?.stale!==false;}
