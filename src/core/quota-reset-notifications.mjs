// Only fresh account readings confirm a reset. Expired countdowns alone do not.
export function observeQuotaResets(saved,{buckets,scope,at}){
  if(!scope||scope==='unidentified'||!Number.isFinite(at))return saved;
  const bucket=buckets.find(b=>b.id==='codex');if(!bucket)return saved;
  const previous=saved?.scope===scope?saved:null;
  const next={scope,windows:{...previous?.windows},event:previous?.event??null},reset=[];
  for(const [role,minutes] of [['five',300],['weekly',10080]]){
    const w=[bucket.primary,bucket.secondary].find(w=>w?.windowDurationMins===minutes);
    if(!w||!Number.isFinite(w.usedPercent))continue;
    const old=previous?.windows?.[role],fresh=old&&at>old.at&&at-old.at<=24*3600000;
    const expired=old?.resetsAt>0&&old.resetsAt*1000<=at;
    const advanced=old?.resetsAt>0&&w.resetsAt>old.resetsAt+60;
    const dropped=old&&old.usedPercent-w.usedPercent>=1&&(expired||w.usedPercent<=1);
    const cycle=old?.resetsAt??old?.at;
    const occurred=fresh&&(expired&&advanced||dropped)&&old.notifiedCycle!==cycle;
    next.windows[role]={usedPercent:w.usedPercent,resetsAt:w.resetsAt,at,notifiedCycle:occurred?cycle:old?.notifiedCycle??null};
    if(occurred)reset.push(role);
  }
  if(reset.length){
    // Give adjacent ten-second polls a chance to combine both reset windows.
    const prior=previous?.event,combine=prior&&at<prior.deliverAfter;
    next.event={id:combine?prior.id:`${scope}:${at}`,at:combine?prior.at:at,deliverAfter:combine?prior.deliverAfter:at+20000,roles:[...new Set([...(combine?prior.roles:[]),...reset])]};
  }
  return next;
}

export function resetNotificationText(roles){
  if(roles.includes("credits"))return ["套餐额度已耗尽，后续请求可能使用 Credits。","Plan quota is exhausted. Further requests may use Credits."];
  if(roles.includes('five')&&roles.includes('weekly'))return ['5 小时和每周额度都已重置','Your 5-hour and weekly quotas have both reset.'];
  if(roles.includes('weekly'))return ['每周额度已重置','Your weekly quota has reset.'];
  return ['5 小时额度已重置','Your 5-hour quota has reset.'];
}
