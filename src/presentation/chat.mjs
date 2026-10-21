// Keep runtime accounting headroom out of user-visible capacity and rings.
export function displayedContextWindow(thread){
  const c=thread?.compensation;
  return c?.enabled && c.status==='active' && c.runtimeWindow===thread.observedWindow && Number.isSafeInteger(c.targetWindow) && c.targetWindow>0 ? c.targetWindow : thread?.observedWindow;
}
import {savedBudget} from '../core/budget.mjs';
export function windowConfirmed(thread){
  const budget=thread?.policy?.enabled===false?null:savedBudget(thread?.policy,thread?.modelMetadata);
  return !!budget&&thread.connected===true&&thread.freshUsage===true&&thread.phase==='confirmed'&&thread.revision===thread.policy.revision&&thread.observedWindow!=null&&thread.observedWindow===thread.expectedWindow&&(thread.observedWindow===budget.usableWindow||(thread.compensation?.status==='active'&&thread.compensation.targetWindow===budget.usableWindow&&thread.compensation.runtimeWindow===thread.observedWindow));
}
export function observedWindowTitle(thread){
  if(windowConfirmed(thread))return '已确认可用窗口';
  if(!thread?.connected||thread.freshUsage!==true)return '上次读回窗口（待更新）';
  return thread.phase==='mismatch'?'运行时读回窗口（与目标不符）':'最近读回窗口';
}
export function modelDisplayName(raw=''){
  if(!raw.toLowerCase().startsWith('gpt-'))return raw;
  const [version,...parts]=raw.slice(4).split('-');return ['GPT-'+version,...parts.map(part=>part.charAt(0).toUpperCase()+part.slice(1).toLowerCase())].join(' ');
}
