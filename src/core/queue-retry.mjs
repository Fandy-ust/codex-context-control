export const QUEUE_RETRY_MINUTES=Object.freeze([1,3,5,10,15,30,45,60]);
export function normalizeTaskRetry(value){
  if(!Number.isSafeInteger(value?.firstFailedAt)||value.firstFailedAt<=0||!Number.isInteger(value.attempts)||value.attempts<0||value.attempts>QUEUE_RETRY_MINUTES.length)return null;
  return {firstFailedAt:value.firstFailedAt,attempts:value.attempts,nextAt:value.attempts<QUEUE_RETRY_MINUTES.length?value.firstFailedAt+QUEUE_RETRY_MINUTES[value.attempts]*60000:null,lastAttemptAt:Number.isSafeInteger(value.lastAttemptAt)?value.lastAttemptAt:null,scope:typeof value.scope==='string'?value.scope:null,awaitingQuota:value.awaitingQuota===true};
}
export function armTaskRetry(task,now){task.retry=normalizeTaskRetry(task.retry)||{firstFailedAt:now,attempts:0,nextAt:now+60000,lastAttemptAt:null,scope:null,awaitingQuota:false};return task.retry;}
export function taskRetryReady(task,now,scope){const r=task.retry;return !r||r.nextAt!=null&&now>=r.nextAt||r.awaitingQuota&&typeof scope==='string'&&r.scope!==scope&&r.lastAttemptAt!=null&&now-r.lastAttemptAt<=60000;}
export function takeTaskRetry(task,now,scope){
  const r=task.retry;if(!r)return;
  if(r.nextAt!=null&&now>=r.nextAt){let count=r.attempts;while(count<QUEUE_RETRY_MINUTES.length&&now>=r.firstFailedAt+QUEUE_RETRY_MINUTES[count]*60000)count++;r.attempts=count;r.lastAttemptAt=now;r.nextAt=count<QUEUE_RETRY_MINUTES.length?r.firstFailedAt+QUEUE_RETRY_MINUTES[count]*60000:null;}
  r.scope=scope??null;r.awaitingQuota=false;
}
export function retrySwitchReady(task,now){return !task.retry||task.retry.nextAt!=null&&now>=task.retry.nextAt||task.retry.awaitingQuota&&task.retry.lastAttemptAt!=null&&now-task.retry.lastAttemptAt<=60000;}
