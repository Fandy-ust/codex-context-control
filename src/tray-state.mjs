import {displayedContextWindow} from './presentation/chat.mjs';
export const runningThread=thread=>thread.connected&&['active','inProgress'].includes(thread.status);
export function trayState(threads=[],available=true){
  const eligible=threads.filter(t=>t.ephemeral!==true&&t.canAcceptDirectInput!==false&&(t.threadSource==null||t.threadSource==='user')&&(t.connected||(t.lastActivityAt??0)>0));
  const running=available?eligible.filter(runningThread):[];
  const recent=eligible.filter(t=>(t.lastActivityAt??0)>0&&(!available||!runningThread(t))).slice(0,5);
  const observed=running.filter(t=>t.freshUsage===true&&t.observedWindow>0&&Number.isSafeInteger(t.lastUsage?.totalTokens)&&t.lastUsage.totalTokens>=0).map(t=>t.lastUsage.totalTokens/displayedContextWindow(t));
  return {running,recent,fraction:observed.length?Math.max(...observed):null};
}
