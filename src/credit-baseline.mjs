// Each observed increase starts a new balance baseline, even below an older peak.
export function observeCreditBalance(previous,raw){
 if(raw==null||!/^\d+(?:\.\d+)?$/.test(String(raw))||!Number.isFinite(Number(raw)))return previous??null;
 const current=Number(raw),valid=Number.isFinite(previous?.last)&&previous.last>=0&&Number.isFinite(previous?.baseline)&&previous.baseline>=previous.last;
 return {last:current,baseline:!valid||current>previous.last?current:previous.baseline};
}
export function creditRemaining(balance,observation){
 const current=Number(balance),baseline=observation?.baseline;
 return balance!=null&&Number.isFinite(current)&&current>=0&&Number.isFinite(baseline)&&baseline>0?Math.max(0,Math.min(100,current/baseline*100)):0;
}
