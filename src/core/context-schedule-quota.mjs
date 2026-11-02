import {exhaustedQuota} from './credits-protection.mjs';

// A handoff continues already authorized work. Ordinary queues retain their
// percentage reserves; only handoffs may use observed extra Credits.
export function contextScheduleQuotaGate(base,quota,protection={},now=Date.now()){
 const normal={...base,source:'quota'};
 if(!base.valid||!base.blocked)return normal;
 if(quota?.stale!==false||!quota.accountScope||quota.accountScope==='unidentified'||!quota.updatedAt||quota.updatedAt>now+1000||now-quota.updatedAt>30000)return normal;
 const bucket=quota.buckets?.find(b=>b.id==='codex');
 const balance=typeof bucket?.creditBalance==='string'&&bucket.creditBalance.trim()!==''||typeof bucket?.creditBalance==='number'?Number(bucket.creditBalance):NaN;
 if(!bucket||(bucket.unlimitedCredits!==true&&!(bucket.hasCredits===true&&Number.isFinite(balance)&&balance>0)))return normal;
 if(protection.stopOnCreditsEnabled===true){
  const exhausted=exhaustedQuota(quota,protection.creditsTrigger,now);
  if(exhausted!==false)return {...normal,reason:exhausted===true?'credits_protection':'credits_protection_unknown'};
 }
 return {...normal,blocked:false,hard:false,source:'credits'};
}
