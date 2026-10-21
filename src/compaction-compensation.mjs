import path from 'node:path';
import {root,codexHome,readJSON,atomicJSON} from './paths.mjs';
import {activeReasoningEstimate,projectCompensationEvent} from './core/compaction-compensation.mjs';

export function createCompensationManager({home=root}={}) {
  const file=path.join(home,'compaction-compensation.json');
  const enabled=()=>{try{return readJSON(file,{})?.enabled===true;}catch{return false;}};
  const status=(bridges=[])=>{
    const on=enabled(),supportedCount=bridges.filter(b=>b.compensationVersion===3).length;
    const pending=on&&supportedCount<bridges.length;
    return {enabled:on,pending,supportedCount,connectedCount:bridges.length,
      message:on?(pending?'已开启，请重开 Codex 加载补偿功能':'已开启；已设置预算的聊天在下轮提交时尝试补偿'):'已关闭；自动应用中的聊天下轮恢复原窗口'};
  };
  return {enabled,status,setEnabled(value){if(typeof value!=='boolean')throw Error('开关值无效');atomicJSON(file,{enabled:value,updatedAt:Date.now()});return status();}};
}

export function createCompensationResolver({home=codexHome,control=root}={}) {
  const manager=createCompensationManager({home:control});
  let loading;
  return async record=>{
    if (!manager.enabled()) return {enabled:false};
    if (!record.turnId && !record.lastUsage && !record.inheritedUsage) return {enabled:true,known:true,extraTokens:0};
    const history=await (loading??=import('./context-history.mjs').then(module=>({read:module.readHistory,cache:module.createHistoryCache({maxBytes:4*1024*1024,maxFiles:16,projectEvent:projectCompensationEvent})})));
    for(let attempt=0;attempt<4;attempt++){
      try{
        const result=activeReasoningEstimate(history.read(home,record.id,history.cache),{threadId:record.id,completedTurnId:record.turnId});
        if(result.known||result.reason!=='pending')return {enabled:true,...result};
      }catch{return {enabled:true,known:false,reason:'history'};}
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    return {enabled:true,known:false,reason:'pending'};
  };
}
