import {defaultQueueConfig,validateQueueConfig} from './queue-config.mjs';
export function inheritedTaskEffort(record){
  return record?.sticky?.collaborationMode?.settings?.reasoning_effort||record?.sticky?.effort||record?.seed?.collaborationMode?.settings?.reasoning_effort||record?.seed?.effort||record?.snapshot?.reasoningEffort||record?.effort||'medium';
}
export function displayedTaskEffort(settings,chat,model){
  const wanted=settings?.effort||(!settings?.model||settings.model===chat?.model?chat?.effort:null)||'medium';
  return !model?.efforts?.length||model.efforts.includes(wanted)?wanted:model.defaultEffort||model.efforts[0];
}
export function normalizeTaskSettings(value,defaults=defaultQueueConfig()){
  const v=value??{};
  if(typeof v!=='object'||Array.isArray(v))throw Error('任务设置无效');
  const model=v.model??'',effort=v.effort??'',approval=v.approval??'inherit';
  if(!['inherit','ask','auto','full'].includes(approval))throw Error('任务权限无效');
  if(typeof model!=='string'||model.length>160||/[\r\n\0]/.test(model))throw Error('任务模型无效');
  if(!['','none','minimal','low','medium','high','xhigh','max','ultra'].includes(effort))throw Error('思考程度无效');
  const files=v.attachments??[];
  if(!Array.isArray(files)||files.length>20)throw Error('每个任务最多添加 20 个附件');
  const attachments=files.map(file=>{
    if(!file||!['image','file'].includes(file.kind)||typeof file.path!=='string'||file.path.length>4096||/[\r\n\0]/.test(file.path)||!(/^(?:[a-z]:[\\/]|\/|\\\\)/i.test(file.path)))throw Error('附件路径无效');
    return {path:file.path,kind:file.kind,name:typeof file.name==='string'?file.name.slice(0,255):file.path.split(/[\\/]/).pop()};
  });
  return {quota:validateQueueConfig(v.quota??defaults),model,effort,approval,attachments};
}
export function taskInput(prompt,settings){
  const files=settings.attachments.filter(f=>f.kind==='file');
  const text=prompt+(files.length?'\n\n附加的本地文件，请先读取内容再处理任务：\n'+files.map(f=>JSON.stringify(f.path)).join('\n'):'');
  return [{type:'text',text,text_elements:[]},...settings.attachments.filter(f=>f.kind==='image').map(f=>({type:'localImage',path:f.path}))];
}
