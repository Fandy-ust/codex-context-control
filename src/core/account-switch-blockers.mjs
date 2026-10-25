// Persisted observations are not proof that a runtime is still executing.
export function accountTaskBlockers({threads=[],tasks={},activation={},sync={}}={}){
  const result=[];
  if(threads.some(t=>t.connected&&(['active','inProgress'].includes(t.status)||['compacting','reloading'].includes(t.phase))))result.push('仍有运行中的任务');
  if(tasks.monitoringEnabled!==false&&tasks.queues?.some(q=>q.enabled&&!q.pause))result.push('任务队列尚未暂停');
  if(activation.busy&&activation.job?.status==='running')result.push('额度探测正在运行');
  if(sync.running)result.push('云同步正在运行，请等待完成');
  return result;
}
