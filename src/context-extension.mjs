import path from 'node:path';
import {root,atomicJSON} from './paths.mjs';
import {contextExtensionEnabled,CONTEXT_CEILING_VERSION} from './context-ceiling.mjs';
export function createContextExtensionManager({home=root}={}){
 const file=path.join(home,'context-extension.json');
 const enabled=()=>contextExtensionEnabled(home);
 function status(bridges=[],{compatible=true,available=true}={}){
  const on=enabled(),connectedCount=bridges.length;
  const activeCount=bridges.filter(b=>b.contextCeiling===CONTEXT_CEILING_VERSION&&b.contextCatalogRevision===2).length;
  const pending=connectedCount>0&&(on?activeCount<connectedCount:bridges.some(b=>b.contextCeiling===CONTEXT_CEILING_VERSION));
  const effective=on&&connectedCount>0&&activeCount===connectedCount;
  let message=on?(connectedCount===0?'已开启，等待 Codex 启动':effective?'已生效 · 上限 920K':'已开启，重开 Codex 后生效'):(pending?'已关闭，重开 Codex 后恢复原生上限':'已关闭 · 使用 Codex 原生上限');
  if(on&&!compatible)message='当前 Codex 版本不支持拓展';
  else if(on&&!available)message='已开启，等待 Codex 模型信息';
  return {enabled:on,effective:effective&&compatible&&available,pending,activeCount,connectedCount,compatible,available,message};
 }
 function setEnabled(value){if(typeof value!=='boolean')throw Error('开关值无效');atomicJSON(file,{enabled:value,updatedAt:Date.now()});}
 return {enabled,status,setEnabled};
}
