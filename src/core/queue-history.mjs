// Presentation only: preserve the pending execution order and durable completion times.
export function queueTaskHistory(tasks,now=Date.now()) {
  const completed=tasks.filter(t=>t.status==='completed').sort((a,b)=>(b.finishedAt??b.createdAt??0)-(a.finishedAt??a.createdAt??0));
  return [...tasks.filter(t=>t.status!=='completed'),...completed].map(t=>{
    const finished=t.finishedAt??t.createdAt;
    return {...t,archivedAt:t.status==='completed'&&Number.isFinite(finished)&&now-finished>=12*3600000?finished+12*3600000:null};
  });
}
