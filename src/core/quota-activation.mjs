import {normalizeQuotaCycles} from './quota-observations.mjs';

export const HOUR=3600000, WEEK=7*24*HOUR;
export function quotaWindow(quota,minutes){
  const bucket=quota?.buckets?.find(b=>b.id==='codex');
  return [bucket?.primary,bucket?.secondary].find(w=>w?.windowDurationMins===minutes)??null;
}
export function resetConfirmed(quota,minutes,at,toleranceMinutes=10){
  const w=quotaWindow(quota,minutes);
  return !quota.stale&&quota.updatedAt>=at&&Number.isFinite(w?.resetsAt)&&Math.abs(w.resetsAt*1000-(at+minutes*60000))<=toleranceMinutes*60000;
}

// Estimate time to spend 100% from observed increments, excluding long idle gaps.
// Never combine accounts, pools or reset cycles, or treat unobserved time as work.
export function activationRecommendation(source,{now=Date.now()}={}){
  const snapshots=normalizeQuotaCycles((source.snapshots??[]).filter(p=>p.scope===source.currentScope&&p.bucket==='codex'&&p.at>=now-21*24*HOUR&&p.at<=now)).snapshots;
  const groups=new Map();
  for(const p of snapshots){if(!Number.isFinite(p.fiveReset)||!Number.isFinite(p.fiveUsed))continue;const k=p.fiveReset;if(!groups.has(k))groups.set(k,[]);groups.get(k).push(p);}
  const samples=[];
  for(const rows of groups.values()){
    rows.sort((a,b)=>a.at-b.at);let used=0,active=0,anchor=rows[0];
    for(let i=1;i<rows.length;i++){
      const dt=rows[i].at-anchor.at,delta=rows[i].fiveUsed-anchor.fiveUsed;
      if(dt<=0)continue;
      if(dt>20*60000||delta<0||delta>30){anchor=rows[i];continue;}
      if(delta>0){used+=delta;active+=dt;anchor=rows[i];}
    }
    if(used>=30&&active>=15*60000)samples.push({at:rows.at(-1).at,hours:active/HOUR*100/used,used});
  }
  const recent=samples.sort((a,b)=>b.at-a.at).slice(0,10),hours=recent.map(s=>s.hours).sort((a,b)=>a-b);
  if(hours.length<3)return {sampleCount:hours.length,leadHours:null,consumptionHours:null,confidence:'insufficient'};
  const quantile=q=>hours[Math.floor((hours.length-1)*q)],typical=quantile(.5);
  const lead=h=>Math.round(Math.max(0,Math.min(4.5,5-h))*4)/4;
  return {sampleCount:hours.length,leadHours:lead(typical),consumptionHours:Math.round(typical*4)/4,leadMinHours:lead(quantile(.75)),leadMaxHours:lead(quantile(.25)),confidence:hours.length>=6?'medium':'low'};
}
