const text=(value,limit)=>typeof value==='string'&&!/[\x00-\x1f\x7f]/.test(value)?value.slice(0,limit):undefined;
const identifier=value=>typeof value==='string'&&/^[\w.:-]{1,160}$/.test(value)&&!['__proto__','constructor','prototype'].includes(value);
const stamp=(value,now)=>Number.isSafeInteger(value)&&value>0&&value<=now+300000?value:null;
function window(value){
  if(!value||!Number.isFinite(value.remainingPercent)||value.remainingPercent<0||value.remainingPercent>100||!Number.isSafeInteger(value.resetsAt)||value.resetsAt<=0||!Number.isInteger(value.windowDurationMins)||value.windowDurationMins<=0)return null;
  return {remainingPercent:value.remainingPercent,usedPercent:100-value.remainingPercent,resetsAt:value.resetsAt,windowDurationMins:value.windowDurationMins};
}
// Only display metadata crosses devices. Never spread an account/auth object.
export function accountSummary(value,now=Date.now()){
  if(!/^[a-f0-9]{32}$/.test(value?.id||''))return null;
  const result={id:value.id,label:text(value.label,160),customName:text(value.customName,40),updatedAt:stamp(value.updatedAt,now)??0};
  const q=value.quota;if(!stamp(q?.updatedAt,now)||!Array.isArray(q?.buckets))return result;
  const buckets=q.buckets.slice(0,8).filter(b=>identifier(b?.id)).map(b=>{
    const balance=b.creditBalance==null?null:String(b.creditBalance),creditBalance=balance&&balance.length<=64&&/^\d+(?:\.\d+)?$/.test(balance)&&Number.isFinite(Number(balance))?balance:null;
    return {id:b.id,name:text(b.name,100)||b.id,primary:window(b.primary),secondary:window(b.secondary),creditBalance,hasCredits:b.hasCredits===true,unlimitedCredits:b.unlimitedCredits===true};
  });
  const creditBaselines=Object.fromEntries(buckets.flatMap(b=>{const v=q.creditBaselines?.[b.id];return Number.isFinite(v?.last)&&v.last>=0&&Number.isFinite(v?.baseline)&&v.baseline>=v.last?[[b.id,{last:v.last,baseline:v.baseline}]]:[];}));
  result.quota={updatedAt:q.updatedAt,buckets,creditBaselines,...(/^[a-f0-9]{32}$/.test(q.sourceDevice||'')?{sourceDevice:q.sourceDevice}:{})};
  return result;
}
