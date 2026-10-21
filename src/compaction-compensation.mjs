import path from 'node:path';
import {root,codexHome,readJSON,atomicJSON} from './paths.mjs';
import {activeReasoningEstimate,projectCompensationEvent} from './core/compaction-compensation.mjs';

export function createCompensationManager({home=root,allowExperimental=false}={}) {
  const file=path.join(home,'compaction-compensation.json');
  const read=()=>{try{return readJSON(file,{})??{};}catch{return {};}};
  const enabled=()=>{
    const saved=read();
    if(!allowExperimental&&saved.enabled===true)atomicJSON(file,{...saved,enabled:false,disabledReason:'compensation-retired',updatedAt:Date.now()});
    return allowExperimental&&saved.enabled===true;
  };
  enabled(); // Migrate an enabled legacy installation before old bridges read it again.

  const status=(bridges=[],threads=[])=>{
    const on=enabled(),supportedCount=bridges.filter(b=>b.compensationVersion===3).length;
    const restoringCount=on?0:threads.filter(t=>t.connected&&t.policy?.enabled&&t.compensation&&(t.compensation.enabled||t.compensation.pendingEnabled===false||(t.compensation.targetWindow!=null&&t.observedWindow!=null&&t.observedWindow!==t.compensation.targetWindow))).length;
    const pending=on&&supportedCount<bridges.length||restoringCount>0;
    return {enabled:on,available:allowExperimental,pending,restoringCount,supportedCount,connectedCount:bridges.length,
      message:restoringCount?'补偿已关闭，等待安全恢复原窗口':!allowExperimental?'提前压缩补偿已停用，保留原生压缩和已保存预算。':on?(pending?'已开启，请重开 Codex 加载补偿功能':'已开启；已设置预算的聊天在下轮提交时尝试补偿'):'已关闭；自动应用中的聊天下轮恢复原窗口'};
  };
  return {enabled,status,setEnabled(value){if(typeof value!=='boolean')throw Error('开关值无效');if(value&&!allowExperimental)throw Error('提前压缩补偿已停用，保留原生压缩和已保存预算。');atomicJSON(file,{...read(),enabled:value,updatedAt:Date.now()});return status();}};
}

export function createCompensationResolver({home=codexHome,control=root,allowExperimental=false}={}) {
  const manager=createCompensationManager({home:control,allowExperimental});
  let loading;
  const resolve=async record=>{
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
  resolve.isEnabled=manager.enabled;
  return resolve;
}
