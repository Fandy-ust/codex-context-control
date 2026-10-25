// Running tasks retain their slots. Return the complete order, including hidden
// history, so reordering visible cards never drops a task.
export function movedQueueOrder(tasks,source,target){
  const movable=tasks.filter(t=>t.status!=='running'),ids=movable.map(t=>t.id),from=ids.indexOf(source),to=ids.indexOf(target);
  if(from<0||to<0||from===to)return null;
  ids.splice(to,0,ids.splice(from,1)[0]);let index=0;
  return tasks.map(t=>t.status==='running'?t.id:ids[index++]);
}
