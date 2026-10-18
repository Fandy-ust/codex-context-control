import {randomUUID} from 'node:crypto';

const pending=t=>['waiting','running','interrupted'].includes(t.status);
export const defaultQueueConfig=()=>({pool:'codex',resume:'auto',fiveHour:{reserve:20,stages:[]},weekly:{reserve:10,stages:[]}});
function percentage(value){if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>100)throw Error('保留比例必须在 0–100% 之间');return value;}
export function validateQueueConfig(value){
  if(!value||!['auto','manual'].includes(value.resume)||typeof value.pool!=='string'||!value.pool.length||value.pool.length>160)throw Error('队列设置无效');
  const out={pool:value.pool,resume:value.resume};
  for(const name of ['fiveHour','weekly']){
    const item=value[name];if(!item||!Array.isArray(item.stages)||item.stages.length>2)throw Error('每种额度最多设置两个释放梯度');
    const reserve=percentage(item.reserve);let previousMinutes=Infinity,previousReserve=reserve;
    const stages=item.stages.map(s=>{if(!Number.isInteger(s.minutes)||s.minutes<1||s.minutes>(name==='fiveHour'?300:10080)||s.minutes>=previousMinutes)throw Error('释放时间应由远到近，且不能重复');const next=percentage(s.reserve);if(next>previousReserve)throw Error('临近重置的保留比例只能降低');previousMinutes=s.minutes;previousReserve=next;return {minutes:s.minutes,reserve:next};});
    out[name]={reserve,stages};
  }return out;
}
export function effectiveReserve(config,window,now){
  let reserve=config.reserve;const until=window?.resetsAt*1000-now;
  if(until>0)for(const stage of config.stages)if(until<=stage.minutes*60000)reserve=stage.reserve;
  return reserve;
}
export function queueQuotaGate(config,quota,now=Date.now()){
  const bucket=quota?.buckets?.find(b=>b.id===config.pool);
  const windows=[['fiveHour',300],['weekly',10080]].map(([name,duration])=>({name,window:[bucket?.primary,bucket?.secondary].find(w=>w?.windowDurationMins===duration)}));
  if(quota?.stale||quota?.error||!quota?.updatedAt||now-quota.updatedAt>30000||windows.some(w=>!w.window||!Number.isFinite(w.window.remainingPercent)||!w.window.resetsAt||w.window.resetsAt*1000<=now))return {valid:false,blocked:true,hard:false,windows:[]};
  const values=windows.map(({name,window})=>({name,resetsAt:window.resetsAt,remaining:window.remainingPercent,reserve:effectiveReserve(config[name],window,now)}));
  return {valid:true,blocked:values.some(w=>w.remaining<=w.reserve),hard:values.some(w=>w.remaining===0||w.remaining<=w.reserve-2),windows:values};
}

// The service owns scheduling; bridges own the exact automatic turn identity.
// Persist before sending so an uncertain delivery is never replayed on restart.
export function createTaskQueues({load=()=>({}),save=()=>{},quota,thread,start,interrupt,inhibit=()=>{},now=Date.now,id=randomUUID}={}){
  const queues=new Map();let ticking=false,timer=null,closed=false,sleep=false,lastSaved='';
  for(const q of Object.values(load()?.queues??{})){
    try{if(typeof q.id!=='string'||!Array.isArray(q.tasks))continue;q.config=validateQueueConfig(q.config);
      if(q.tasks.some(t=>t.status==='running')){q.enabled=false;q.message='上次执行未确认完成，请核对后手动继续';for(const t of q.tasks)if(t.status==='running')t.status='interrupted';}
      queues.set(q.id,q);
    }catch{/* Ignore invalid persisted entries without starting them. */}
  }
  const active=q=>q.enabled&&q.tasks.some(pending);
  function persist(){const value={version:1,queues:Object.fromEntries(queues)},serialized=JSON.stringify(value);if(serialized!==lastSaved){save(value);lastSaved=serialized;}sync();}
  function sync(){const needed=!closed&&[...queues.values()].some(active);if(sleep!==needed){sleep=needed;inhibit(needed);}if(needed&&!timer){timer=setInterval(()=>void tick(),1000);timer.unref?.();}if(!needed&&timer){clearInterval(timer);timer=null;}}
  function list(){return {sleepPrevented:sleep,queues:[...queues.values()].map(q=>structuredClone(q))};}
  function get(key){return queues.get(key);}
  function command(p){
    if(p.action==='disable-all'){for(const q of queues.values()){q.enabled=false;q.message='监视已关闭；当前轮次结束后停止队列';q.revision++;}persist();return list();}
    if(typeof p.id!=='string'||!p.id.length||p.id.length>180||['__proto__','constructor','prototype'].includes(p.id)||!thread(p.id))throw Error('未找到聊天');
    let original=queues.get(p.id);if(p.expectedRevision!=null&&p.expectedRevision!==(original?.revision??0))throw Error('队列已更新，请刷新后重试');
    const q=structuredClone(original??{id:p.id,enabled:false,config:defaultQueueConfig(),tasks:[],revision:0,state:'off',message:'未开启监视'});
    const task=()=>{const t=q.tasks.find(t=>t.id===p.taskId);if(!t)throw Error('未找到任务');return t;};
    const text=()=>{if(typeof p.prompt!=='string'||!p.prompt.trim()||p.prompt.length>16000)throw Error('任务内容应为 1–16000 个字符');return p.prompt.trim();};
    if(p.action==='add'){if(q.tasks.length>=200)throw Error('每个聊天最多保留 200 个任务');q.tasks.push({id:id(),prompt:text(),status:'waiting',createdAt:now()});}
    else if(p.action==='edit'){const t=task();if(t.status==='running')throw Error('不能编辑执行中的任务');t.prompt=text();}
    else if(p.action==='delete'){if(task().status==='running')throw Error('请先停止执行中的任务');q.tasks=q.tasks.filter(t=>t.id!==p.taskId);}
    else if(p.action==='reorder'){if(!Array.isArray(p.order)||p.order.length!==q.tasks.length||new Set(p.order).size!==q.tasks.length||p.order.some(key=>!q.tasks.some(t=>t.id===key)))throw Error('排序无效');q.tasks=p.order.map(key=>q.tasks.find(t=>t.id===key));}
    else if(p.action==='config')q.config=validateQueueConfig(p.config);
    else if(p.action==='enable'){if(typeof p.enabled!=='boolean')throw Error('开关值无效');q.enabled=p.enabled;if(p.enabled){q.pause=null;const chat=thread(q.id);if(chat.status==='active'&&!chat.turnId)throw Error('等待运行时同步当前轮次');if(chat.status==='active'&&chat.turnId&&!q.tasks.some(t=>t.status==='running'||t.kind==='current'&&pending(t)))q.tasks.unshift({id:id(),prompt:'当前执行中的任务',kind:'current',turnId:chat.turnId,status:'waiting',createdAt:now()});}q.message=p.enabled?'等待检查额度':'监视已关闭';}
    else if(p.action==='pause-cycle'){const state=quota.state(),gate=queueQuotaGate(q.config,state,now());if(!gate.valid)throw Error('请先读取有效额度');q.pause={kind:'cycle',until:Math.min(...gate.windows.map(w=>w.resetsAt))*1000};q.message='仅暂停到下一次额度重置';}
    else if(p.action==='retry'){const t=task();if(!['error','interrupted'].includes(t.status))throw Error('该任务无需重试');t.continuation=t.status==='interrupted';t.status='waiting';t.error=null;q.pause=null;}
    else if(p.action==='stop'){const t=task();if(t.status!=='running')throw Error('当前任务未在执行');q.enabled=false;q.message='已请求停止当前任务';void interrupt(q.id,t.executionId).catch(error=>{const current=queues.get(q.id);if(current){current.message=error.message;persist();}});}
    else throw Error('队列操作无效');
    if(q.enabled&&!q.tasks.some(pending))q.enabled=false;
    q.revision++;queues.set(q.id,q);persist();void tick();return list();
  }
  async function tick(){
    if(ticking||closed||![...queues.values()].some(q=>active(q)||q.tasks.some(t=>t.status==='running')))return;
    ticking=true;
    try{
      if([...queues.values()].some(active))await quota.refresh(true);
      for(const q of queues.values()){
        const chat=thread(q.id),running=q.tasks.find(t=>t.status==='running'),owned=chat?.automaticTask;
        if(running){
          if(chat?.connected&&!chat.ambiguous&&owned?.executionId!==running.executionId){running.status='interrupted';q.enabled=false;q.state='off';q.message='执行状态待核对，监视已关闭';continue;}
          if(owned?.executionId===running.executionId&&['completed','error','interrupted'].includes(owned.status)){
            running.status=owned.status==='completed'?'completed':owned.status;running.error=owned.error??null;running.finishedAt=now();
            if(running.status==='error'){q.pause={kind:'manual'};q.message='任务执行失败，请检查后重试';}
            if(running.status==='interrupted'&&!q.pause){q.pause={kind:'manual'};q.message='任务已中断，请手动继续';}
          }else{
            q.state=q.enabled?'running':'stopping';
            if(q.enabled){const gate=queueQuotaGate(q.config,quota.state(),now());if(gate.hard&&owned?.executionId===running.executionId&&owned.status==='running'&&!running.interruptRequested){running.interruptRequested=true;persist();try{await interrupt(q.id,running.executionId);}catch(error){running.interruptRequested=false;q.message=error.message;}q.pause={kind:'quota',windows:gate.windows.filter(w=>w.remaining<=w.reserve)};q.message='超过保护线，已请求中断队列轮次';}else if(gate.blocked)q.message='额度触线，当前轮次结束后暂停';}
            continue;
          }
        }
        if(!q.enabled){q.state='off';continue;}
        const next=q.tasks.find(pending);if(!next){q.enabled=false;q.state='complete';q.message='队列已完成，监视已自动关闭';continue;}
        if(next.kind==='current'&&next.status==='waiting'){
          if(!chat?.connected||chat.ambiguous){q.state='waiting-chat';continue;}
          if(chat.status!=='active'||chat.turnId!==next.turnId){next.status='completed';q.message='当前轮次已结束';continue;}
          next.status='running';next.executionId=id();next.startedAt=now();persist();
          try{await start(q.id,{executionId:next.executionId,taskId:next.id,adoptTurnId:next.turnId});}catch(error){next.status='error';next.error=error.message;q.pause={kind:'manual'};}
          continue;
        }
        const gate=queueQuotaGate(q.config,quota.state(),now());
        if(!gate.valid){q.state='waiting-quota';q.message='等待有效额度，不启动新轮次';continue;}
        if(gate.blocked){q.pause??={kind:'quota',windows:gate.windows.filter(w=>w.remaining<=w.reserve)};q.state='paused';q.message='已到最低保留额度';continue;}
        if(q.pause){
          const reset=q.pause.kind==='cycle'?now()>=q.pause.until:q.pause.kind==='quota'&&q.config.resume==='auto'&&q.pause.windows.every(old=>gate.windows.some(w=>w.name===old.name&&(w.resetsAt>old.resetsAt||w.reserve<old.reserve&&w.remaining>w.reserve)));
          if(!reset){q.state='paused';continue;}q.pause=null;
        }
        if(!chat?.connected||chat.ambiguous||chat.status!=='idle'||chat.ephemeral||chat.canAcceptDirectInput===false||['compacting','reloading','extension_pending'].includes(chat.phase)){q.state='waiting-chat';q.message='等待唯一连接且空闲的聊天';continue;}
        const continuation=next.status==='interrupted'||next.continuation;next.status='running';next.executionId=id();next.startedAt=now();next.interruptRequested=false;q.state='running';q.message='正在执行队列任务';persist();
        try{await start(q.id,{executionId:next.executionId,taskId:next.id,prompt:continuation?'继续上次被额度保护中断的任务，先检查已有进度，避免重复操作。原任务：\n'+next.prompt:next.prompt});}
        catch(error){next.status='error';next.error=error.message;q.pause={kind:'manual'};q.message='任务提交未确认，请核对后重试';}
      }
      persist();
    }catch(error){for(const q of queues.values())if(active(q)){q.state='waiting-quota';q.message=error.message;}persist();}
    finally{ticking=false;}
  }
  persist();return {list,get,command,tick,close(){closed=true;clearInterval(timer);inhibit(false);}};
}
