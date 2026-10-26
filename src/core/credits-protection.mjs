// Quota exhaustion indicates a risk of paid usage, not proof of a credit charge.
export function exhaustedQuota(quota,mode='both',now=Date.now()){
  if(quota?.stale!==false||!quota.updatedAt||quota.updatedAt>now+1000||now-quota.updatedAt>30000||!quota.accountScope||quota.accountScope==='unidentified')return null;
  const bucket=quota.buckets?.find(b=>b.id==='codex');
  const windows=[300,10080].map(minutes=>[bucket?.primary,bucket?.secondary].find(w=>w?.windowDurationMins===minutes));
  const valid=w=>Number.isFinite(w?.usedPercent)&&w.usedPercent>=0&&w.usedPercent<=100;
  if(!windows.every(valid))return null;
  const zero=windows.map(w=>w.usedPercent>=100);
  return mode==='either'?zero.some(Boolean):zero.every(Boolean);
}
