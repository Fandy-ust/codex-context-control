import {queueQuotaGate} from './task-queues.mjs';
import {retrySwitchReady} from './core/queue-retry.mjs';

const unfinished=t=>t.kind!=='current'&&!t.monitorOnly&&(['waiting','interrupted'].includes(t.status)||t.status==='error'&&t.retry);
export function accountSwitchDemand(state,current,now=Date.now()){
  if(state.monitoringEnabled===false||!current?.id)return null;
  for(const q of state.queues||[]){
    if(!q.enabled||q.pause&&!['quota','account-quota'].includes(q.pause.kind)||q.tasks.some(t=>t.status==='running'||t.status==='error'&&!t.retry))continue;
    const task=q.tasks.find(unfinished),config=task?.settings?.quota??q.config;
    if(!task||config.resume!=='auto'||!retrySwitchReady(task,now)||task.retry&&config.retryEnabled===false)continue;
    const gate=queueQuotaGate(config,current.quota,now);
    if(gate.valid&&(gate.blocked||q.pause?.kind==='account-quota'&&q.pause.scope===current.quota.accountScope))return {queueId:q.id,taskId:task.id,config};
  }
  return null;
}

// Runs outside the queue tick: a switch may suspend and drain that scheduler.
// Journal the intended identity before closing a runtime or changing auth.
export function createQueueAccountSwitch({load=()=>({}),save=()=>{},queues,current,profiles,inspect,switchAccount,refreshCurrent,openDesktop,ready=async()=>{},now=Date.now}={}){
  let saved=load()||{},enabled=saved.enabled===true,pending=saved.pending??null,lastSwitchAt=saved.lastSwitchAt??0;
  let busy=false,closed=false,lastCheckAt=0,phase=pending?'awaiting-account':'idle',message=pending?'正在核对上次切换后的账号':'自动切换尚未开启';
  const cooldowns=new Map();
  const persist=()=>save({version:1,enabled,pending,lastSwitchAt});
  const state=()=>({enabled,busy,phase,message,lastSwitchAt,targetId:pending?.target??null});
  const demand=()=>accountSwitchDemand(queues.list(),current(),now());
  const dispatchAllowed=()=>!pending&&!busy;
  function configure(value){if(typeof value!=='boolean')throw Error('开关值无效');enabled=value;if(!busy&&!value){phase=pending?'awaiting-account':'idle';message=pending?'自动切换已关闭，等待已切换账号的身份确认':'自动切换已关闭';}else if(!busy){phase='waiting';message='已开启：额度不足时自动切换账号并继续队列';}persist();return state();}
  async function verify(){
    const observed=await refreshCurrent();
    if(observed?.id!==pending?.target||!observed?.quota?.updatedAt||observed.quota.updatedAt<pending.since||observed.quota.stale||observed.quota.error){phase='awaiting-account';message='等待新账号的实时额度与身份确认，队列已保留';return false;}
    pending=null;phase='ready';message='账号已切换，队列将按原顺序继续';persist();return true;
  }
  async function tick(){
    if(busy||closed||!enabled&&!pending||lastCheckAt&&now()-lastCheckAt<30000)return;
    if(!pending&&!demand()){phase='waiting';message=current()?.id?'等待队列任务或下一次重试时点':'请先保存当前登录，并读取有效额度';return;}
    lastCheckAt=now();busy=true;let resume,context={automatic:true},attempted=false,switched=false;
    try{
      resume=await queues.suspend();if(closed||!enabled&&!pending)return;
      if(pending){await verify();return;}
      if(lastSwitchAt&&now()-lastSwitchAt<120000){phase='waiting';message='切换冷却中，队列已保留';return;}
      const source=current(),requested=demand();if(!requested)return;
      phase='checking';message='正在检查其他已保存账号的实时额度';await ready();
      const candidates=profiles().filter(p=>p.id!==source.id&&(cooldowns.get(p.id)??0)<=now());let selected=null;
      for(const candidate of candidates.slice(0,3)){
        if(closed||!enabled)return;
        try{const quota=await inspect(candidate.id),gate=queueQuotaGate(requested.config,quota,now());if(gate.valid&&!gate.blocked){selected=candidate;break;}}catch{/* Keep credentials and the queue; another saved login may work. */}
        cooldowns.set(candidate.id,now()+300000);
      }
      if(!selected){phase='waiting';message='没有可用额度的已授权账号，等待额度恢复或添加账号';return;}
      const latest=demand();if(!enabled||closed||current()?.id!==source.id||latest?.queueId!==requested.queueId||latest?.taskId!==requested.taskId)return;
      await ready();context={automatic:true,expectedSourceId:source.id,authorized:()=>enabled&&!closed&&current()?.id===source.id&&demand()?.taskId===requested.taskId};
      pending={source:source.id,target:selected.id,since:now()};phase='switching';message='正在切换账号并重新打开 Codex';persist();attempted=true;
      await switchAccount(selected.id,context);switched=true;lastSwitchAt=now();persist();
      await openDesktop();context.runtimeClosed=false;
      await verify();
    }catch(error){
      if(attempted&&!switched&&!context.committed)pending=null;
      phase=pending?'awaiting-account':'waiting';message=error?.message||'自动切换未完成，队列已保留';persist();
      if(context.runtimeClosed)try{await openDesktop();}catch{message='请手动打开 Codex；队列已保留，等待账号确认';}
    }finally{resume?.();busy=false;if(!enabled&&!pending){phase='idle';message='自动切换已关闭';}persist();}
  }
  persist();return {state,configure,tick,dispatchAllowed,retarget(id){if(pending&&!busy){pending={...pending,target:id,since:now()};persist();}},close(){closed=true;}};
}
