import {queueTaskHistory} from './core/queue-history.mjs';
import {taskCommand} from './core/task-command.mjs';
import {randomUUID,createHash} from 'node:crypto';
import {QUEUE_RUNTIME_RESTART} from './core/queue-runtime.mjs';

const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const additionHash=p=>createHash('sha256').update(JSON.stringify(canonical({prompt:typeof p.prompt==='string'?p.prompt.trim():p.prompt,settings:p.settings??null}))).digest('hex');
const pending=t=>['waiting','running','interrupted'].includes(t.status)&&!(t.kind==='current'&&t.finishedAt!=null);
export {defaultQueueConfig,validateQueueConfig} from './core/queue-config.mjs';
import {defaultQueueConfig,validateQueueConfig} from './core/queue-config.mjs';
import {normalizeTaskSettings} from './core/task-settings.mjs';
import {armTaskRetry,normalizeTaskRetry,taskRetryReady,takeTaskRetry} from './core/queue-retry.mjs';
const retryEnabled=config=>config?.retryEnabled!==false&&config?.resume==='auto';
export function effectiveReserve(config,window,now){
  let reserve=config.reserve;const until=window?.resetsAt*1000-now;
  if(until>0)for(const stage of config.stages)if(until<=stage.minutes*60000)reserve=stage.reserve;
  return reserve;
}
export function queueQuotaGate(config,quota,now=Date.now()){
  const bucket=quota?.buckets?.find(b=>b.id===config.pool);
  const windows=[['fiveHour',300],['weekly',10080]].map(([name,duration])=>({name,window:[bucket?.primary,bucket?.secondary].find(w=>w?.windowDurationMins===duration)})).filter(w=>w.window);
  if(quota?.stale||quota?.error||!quota?.updatedAt||now-quota.updatedAt>30000||!windows.length||windows.some(w=>!w.window||!Number.isFinite(w.window.remainingPercent)||!w.window.resetsAt||w.window.resetsAt*1000<=now))return {valid:false,blocked:true,hard:false,windows:[]};
  const values=windows.map(({name,window})=>({name,resetsAt:window.resetsAt,remaining:window.remainingPercent,reserve:effectiveReserve(config[name],window,now)}));
  return {valid:true,blocked:values.some(w=>w.remaining<=w.reserve),hard:values.some(w=>w.remaining===0||w.remaining<=w.reserve-2),windows:values};
}

// The service owns scheduling; bridges own the exact automatic turn identity.
// Persist before sending so an uncertain delivery is never replayed on restart.
export function createTaskQueues({load=()=>({}),save=()=>{},quota,thread,start,prepare=async()=>{},interrupt,inhibit=()=>{},canDispatch=()=>true,canSwitchAccounts=()=>false,now=Date.now,id=randomUUID}={}){
  const saved=load()??{},queues=new Map();let monitoringEnabled=saved.monitoringEnabled!==false,ticking=false,suspended=0,timer=null,closed=false,sleep=false,lastSaved='';
  for(const q of Object.values(saved.queues??{})){
    try{if(typeof q.id!=='string'||!Array.isArray(q.tasks))continue;q.config=validateQueueConfig(q.config);for(const t of q.tasks){t.settings=normalizeTaskSettings(t.settings,q.config);const retry=normalizeTaskRetry(t.retry);if(retry)t.retry=retry;else delete t.retry;}
      // Observations are reattached to the live turn after restart; they are
      // never persisted as resumable prompts.
      q.tasks=q.tasks.filter(t=>t.kind!=='current');
      if(q.tasks.some(t=>t.status==='running')){q.pause={kind:'manual'};q.message='上次执行未确认完成，请核对后手动继续';for(const t of q.tasks)if(t.status==='running'){t.status='interrupted';delete t.retry;}}
      queues.set(q.id,q);
    }catch{/* Ignore invalid persisted entries without starting them. */}
  }
  const active=q=>monitoringEnabled&&q.enabled;
  function persist(){if(closed)return;const value={version:1,monitoringEnabled,queues:Object.fromEntries(queues)},serialized=JSON.stringify(value);if(serialized!==lastSaved){save(value);lastSaved=serialized;}sync();}
  function sync(){const needed=!closed&&[...queues.values()].some(active),poll=!closed&&(needed||[...queues.values()].some(q=>q.tasks.some(t=>t.status==='running')));if(sleep!==needed){sleep=needed;inhibit(needed);}if(poll&&!timer){timer=setInterval(()=>void tick(),1000);timer.unref?.();}if(!poll&&timer){clearInterval(timer);timer=null;}}
  function list(){return {monitoringEnabled,sleepPrevented:sleep,queues:[...queues.values()].map(q=>({...structuredClone(q),tasks:queueTaskHistory(structuredClone(q.tasks.filter(t=>!t.monitorOnly)),now())}))};}
  function get(key){return queues.get(key);}
  function command(p){
    if(p.action==='monitoring'){if(typeof p.enabled!=='boolean')throw Error('开关值无效');monitoringEnabled=p.enabled;for(const q of queues.values())if(q.enabled)q.message=p.enabled?'等待检查额度':'全局监视已暂停；保留此聊天的监视设置';persist();void tick();return list();}
    if(p.action==='disable-all'){for(const q of queues.values()){q.enabled=false;q.message='监视已关闭；当前轮次结束后停止队列';q.revision++;}persist();return list();}
    if(typeof p.id!=='string'||!p.id.length||p.id.length>180||['__proto__','constructor','prototype'].includes(p.id)||!thread(p.id))throw Error('未找到聊天');
    let original=queues.get(p.id);
    if(p.action==='add'&&p.requestId!=null){
      if(typeof p.requestId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(p.requestId))throw Error('请求标识无效');
      const existing=original?.tasks.find(t=>t.requestId===p.requestId);
      if(existing){if(existing.requestHash!==additionHash(p))throw Error('同一请求标识不能用于不同任务');return list();}
    }
    if(p.expectedRevision!=null&&p.expectedRevision!==(original?.revision??0))throw Error('队列已更新，请刷新后重试');
    const q=structuredClone(original??{id:p.id,enabled:false,config:defaultQueueConfig(),tasks:[],revision:0,state:'off',message:'未开启监视'});
    if(p.action==='enable'&&p.enabled&&(thread(q.id)?.taskQueueRestartRequired||thread(q.id)?.connected&&thread(q.id)?.taskQueueSupported===false))throw Error(QUEUE_RUNTIME_RESTART);
    const task=()=>{const t=q.tasks.find(t=>t.id===p.taskId);if(!t)throw Error('未找到任务');return t;};
    const text=()=>{if(typeof p.prompt!=='string'||!p.prompt.trim()||p.prompt.length>16000)throw Error('任务内容应为 1–16000 个字符');const value=p.prompt.trim();if(taskCommand(value)&&p.settings?.attachments?.length)throw Error('压缩指令不需要附件，请将附件放到下一项任务');return value;};
    if(p.action==='add'){if(q.tasks.filter(t=>!t.monitorOnly).length>=200)throw Error('每个聊天最多保留 200 个任务');q.tasks.push({id:id(),...(p.requestId?{requestId:p.requestId,requestHash:additionHash(p)}:{}),prompt:text(),status:'waiting',createdAt:now(),settings:normalizeTaskSettings(p.settings,q.config)});}
    else if(p.action==='edit'){const t=task();if(t.status==='running')throw Error('不能编辑执行中的任务');t.prompt=text();if(p.settings!=null)t.settings=normalizeTaskSettings(p.settings,q.config);}
    else if(p.action==='delete'){if(task().status==='running')throw Error('请先停止执行中的任务');q.tasks=q.tasks.filter(t=>t.id!==p.taskId);}
    else if(p.action==='reorder'){const tasks=q.tasks.filter(t=>!t.monitorOnly);if(!Array.isArray(p.order)||p.order.length!==tasks.length||new Set(p.order).size!==tasks.length||p.order.some(key=>!tasks.some(t=>t.id===key)))throw Error('排序无效');if(tasks.some((t,i)=>t.status==='running'&&p.order[i]!==t.id))throw Error('不能移动执行中的任务');q.tasks=[...q.tasks.filter(t=>t.monitorOnly),...p.order.map(key=>tasks.find(t=>t.id===key))];}
    else if(p.action==='config')q.config=validateQueueConfig(p.config);
    else if(p.action==='task-config'){const t=task();t.settings={...normalizeTaskSettings(t.settings,q.config),quota:validateQueueConfig(p.config)};}
    else if(p.action==='enable'){if(typeof p.enabled!=='boolean')throw Error('开关值无效');q.enabled=p.enabled;if(p.enabled)q.pause=null;q.message=p.enabled?(monitoringEnabled?'等待检查额度':'全局监视已暂停；保留此聊天的监视设置'):'监视已关闭';}
    else if(p.action==='pause-cycle'){const state=quota.state(),gate=queueQuotaGate(q.tasks.find(t=>t.status==='running')?.settings?.quota??q.config,state,now());if(!gate.valid)throw Error('请先读取有效额度');q.pause={kind:'cycle',until:Math.min(...gate.windows.map(w=>w.resetsAt))*1000};q.message='仅暂停到下一次额度重置';}
    else if(p.action==='retry'){const t=task();if(!['error','interrupted'].includes(t.status))throw Error('该任务无需重试');t.continuation=t.continuation===true||t.status==='interrupted'||t.errorConfirmed===true;t.status='waiting';t.error=null;delete t.retry;q.pause=null;}
    else if(p.action==='stop'){const t=task();if(t.status!=='running')throw Error('当前任务未在执行');q.enabled=false;delete t.retry;q.pause={kind:'manual'};q.message='已请求停止当前任务';void interrupt(q.id,t.executionId).catch(error=>{const current=queues.get(q.id);if(current){current.message=error.message;persist();}});}
    else throw Error('队列操作无效');
    q.revision++;queues.set(q.id,q);persist();void tick();return list();
  }
  async function tick(){
    if(ticking||suspended||closed||![...queues.values()].some(q=>active(q)||q.tasks.some(t=>t.status==='running')))return;
    ticking=true;
    try{
      if([...queues.values()].some(active))await quota.refresh(true);
      if(closed||suspended)return;
      for(const q of queues.values()){
        if(suspended||closed)return;
        const chat=thread(q.id),running=q.tasks.find(t=>t.status==='running'),owned=chat?.automaticTask;
        let config=running?.kind==='current'?q.config:running?.settings?.quota??q.tasks.find(pending)?.settings?.quota??q.config;
        if(chat?.taskQueueRestartRequired||chat?.connected&&chat.taskQueueSupported===false){q.state='waiting-runtime';q.message=QUEUE_RUNTIME_RESTART;continue;}
        if(running){
          if(chat?.connected&&!chat.ambiguous&&owned?.executionId!==running.executionId){running.status='interrupted';if(running.kind==='current')q.tasks=q.tasks.filter(t=>t!==running);q.pause={kind:'manual'};q.state='paused';q.message='执行状态待核对；持续监视保留，队列等待手动继续';continue;}
          if(owned?.executionId===running.executionId&&['completed','error','interrupted'].includes(owned.status)){
            running.status=owned.status==='completed'?'completed':owned.status;running.error=owned.error??null;running.finishedAt=now();
            running.errorConfirmed=owned.errorConfirmed===true;if(owned.status==='error'&&!owned.errorConfirmed&&owned.errorCode!=='usageLimitExceeded')delete running.retry;
            if(owned.status==='completed')delete running.retry;
            if(running.kind!=='current'&&owned.status==='error'&&owned.errorCode==='usageLimitExceeded'&&canSwitchAccounts()){running.status='interrupted';running.continuation=true;q.pause={kind:'account-quota',scope:quota.state().accountScope};q.message='账号额度不足，等待自动切换账号';}
            if(running.kind!=='current'&&running.status==='error'){q.pause={kind:'manual'};q.message='任务执行失败，请检查后重试';}
            if(running.kind!=='current'&&active(q)&&retryEnabled(config)&&(owned.status==='error'&&(owned.errorConfirmed===true||owned.errorCode==='usageLimitExceeded')||owned.status==='interrupted'&&running.interruptRequested&&q.pause?.kind==='quota')){armTaskRetry(running,now());if(q.pause?.kind==='manual')q.pause={kind:'retry'};q.message='等待自动重试，任务和进度已保留';}
            if(running.kind!=='current'&&running.status==='interrupted'&&!q.pause){q.pause={kind:'manual'};q.message='任务已中断，请手动继续';}
          }else{
            q.state=active(q)?'running':'stopping';
            if(active(q)){const gate=queueQuotaGate(config,quota.state(),now());if((running.kind==='current'?gate.valid&&gate.blocked:gate.hard)&&owned?.executionId===running.executionId&&owned.status==='running'&&!running.interruptRequested){running.interruptRequested=true;persist();try{await interrupt(q.id,running.executionId);q.pause={kind:'quota',scope:quota.state().accountScope,windows:gate.windows.filter(w=>w.remaining<=w.reserve)};q.message='已到保留额度，已请求停止当前轮次；持续监视保持开启';}catch(error){running.interruptRequested=false;q.message=error.message;}}else if(!gate.valid)q.message='等待有效额度，持续监视保持开启';else if(gate.blocked)q.message='额度触线，当前轮次结束后暂停';}
            continue;
          }
        }
        if(!q.enabled){q.state='off';continue;}
        if(!monitoringEnabled){q.state='global-off';q.message='全局监视已暂停；保留此聊天的监视设置';continue;}
        if(!canDispatch()){q.state='switching-account';q.message='正在切换账号，等待身份与额度确认';continue;}
        if(!chat?.connected&&chat?.queueCanLoad){q.state='loading-chat';q.message='正在后台加载聊天';await prepare(q.id);continue;}
        // Adopt each new user-started turn by its exact identity. Monitoring
        // records never become prompts and cannot replay a user's manual work.
        if(chat?.connected&&!chat.ambiguous&&!chat.ephemeral&&chat.canAcceptDirectInput!==false&&chat.status==='active'&&chat.turnId&&!q.tasks.some(t=>t.kind==='current'&&t.turnId===chat.turnId)){
          q.tasks=q.tasks.filter(t=>!t.monitorOnly||pending(t));
          q.tasks.unshift({id:id(),prompt:'当前执行中的任务',kind:'current',monitorOnly:true,turnId:chat.turnId,status:'waiting',createdAt:now(),settings:normalizeTaskSettings(null,q.config)});
        }
        const next=q.tasks.find(t=>pending(t)||t.status==='error'&&t.retry);config=next?.kind==='current'?q.config:next?.settings?.quota??q.config;
        if(!next){const gate=queueQuotaGate(q.config,quota.state(),now());q.state=!gate.valid?'waiting-quota':gate.blocked?'paused':'monitoring';q.message=!gate.valid?'等待有效额度，持续监视保持开启':gate.blocked?'已到最低保留额度，持续监视保持开启':'持续监视中；后续聊天轮次将自动检查额度';continue;}
        if(next.kind==='current'&&next.status==='waiting'){
          if(!chat?.connected||chat.ambiguous){q.state='waiting-chat';continue;}
          if(chat.status!=='active'||chat.turnId!==next.turnId){next.status='completed';next.finishedAt=now();q.message='当前轮次已结束';continue;}
          next.status='running';next.executionId=id();next.startedAt=now();persist();
          try{await start(q.id,{executionId:next.executionId,taskId:next.id,adoptTurnId:next.turnId});}catch(error){q.tasks=q.tasks.filter(t=>t!==next);q.message=error.message;}
          continue;
        }
        if(q.tasks.some(t=>t.kind!=='current'&&t.status==='error'&&!t.retry)){q.state='error';q.message='队列中有失败任务，请重试或删除后继续；持续监视保持开启';continue;}
        let scheduledRetry=false;
        if(q.pause?.kind==='cycle'&&now()>=q.pause.until)q.pause=null;
        if(next.retry){
          if(owned&&owned.executionId===next.executionId&&owned.status==='completed'){next.status='completed';next.finishedAt=now();delete next.retry;continue;}
          if(!retryEnabled(config)){q.state='paused';q.message='自动重试已关闭，任务已保留';continue;}
          if(!taskRetryReady(next,now(),quota.state().accountScope)){
            if(next.retry.nextAt==null&&now()-(next.retry.lastAttemptAt??0)>60000){next.status='error';next.error='8 次自动重试未成功，请手动处理';delete next.retry;q.pause={kind:'manual'};q.state='error';q.message=next.error;}
            else{q.state='retry-wait';q.message='等待自动重试，任务和进度已保留';}
            continue;
          }
          if(q.pause&&!['retry','quota','account-quota'].includes(q.pause.kind)){q.state='paused';continue;}
          takeTaskRetry(next,now(),quota.state().accountScope);scheduledRetry=true;persist();
        }
        const gate=queueQuotaGate(config,quota.state(),now());
        if(!gate.valid){q.state='waiting-quota';q.message='等待有效额度，不启动新轮次';continue;}
        if(gate.blocked){if(!q.pause||q.pause.kind==='retry')q.pause={kind:'quota',scope:quota.state().accountScope,windows:gate.windows.filter(w=>w.remaining<=w.reserve)};if(retryEnabled(config)&&['quota','account-quota'].includes(q.pause.kind)){armTaskRetry(next,now());if(next.retry.lastAttemptAt!=null)next.retry.awaitingQuota=true;}q.state='paused';q.message='已到最低保留额度';continue;}
        if(q.pause){
          const scopeChanged=typeof q.pause.scope==='string'&&typeof quota.state().accountScope==='string'&&q.pause.scope!==quota.state().accountScope;
          const reset=q.pause.kind==='retry'||q.pause.kind==='quota'&&scheduledRetry||(q.pause.kind==='cycle'?now()>=q.pause.until:config.resume==='auto'&&(q.pause.kind==='account-quota'?scopeChanged:q.pause.kind==='quota'&&(scopeChanged||q.pause.windows.every(old=>!gate.windows.some(w=>w.name===old.name)||gate.windows.some(w=>w.name===old.name&&(w.resetsAt>old.resetsAt||w.reserve<old.reserve&&w.remaining>w.reserve))))));
          if(!reset){if(q.pause.kind==='account-quota'&&scheduledRetry)next.retry.awaitingQuota=true;q.state='paused';continue;}q.pause=null;
        }
        if(!chat?.connected||chat.ambiguous||chat.status!=='idle'||chat.ephemeral||chat.canAcceptDirectInput===false||['compacting','reloading','extension_pending'].includes(chat.phase)){q.state='waiting-chat';q.message='等待唯一连接且空闲的聊天';continue;}
        const continuation=next.status==='interrupted'||next.continuation||next.status==='error'&&next.errorConfirmed;next.status='running';next.executionId=id();next.startedAt=now();next.finishedAt=null;next.interruptRequested=false;q.state='running';q.message='正在执行队列任务';persist();
        try{const receipt=await start(q.id,{executionId:next.executionId,taskId:next.id,settings:next.settings,prompt:continuation&&!taskCommand(next.prompt)?'继续上次被额度保护中断的任务，先检查已有进度，避免重复操作。原任务：\n'+next.prompt:next.prompt});if(receipt?.status==='error'){next.status='error';next.error=receipt.error;next.errorConfirmed=receipt.errorConfirmed===true;q.pause={kind:'manual'};if(next.errorConfirmed&&active(q)&&retryEnabled(config)){armTaskRetry(next,now());q.pause={kind:'retry'};q.message='等待自动重试，任务和进度已保留';}else{delete next.retry;q.message='任务提交未确认，请核对后重试';}}}
        catch(error){next.status='error';next.error=error.message;next.errorConfirmed=false;delete next.retry;q.pause={kind:'manual'};q.message='任务提交未确认，请核对后重试';}
      }
      persist();
    }catch(error){for(const q of queues.values())if(active(q)){q.state='waiting-quota';q.message=error.message;}persist();}
    finally{ticking=false;}
  }
  persist();return {list,get,command,tick,async suspend(){suspended++;while(ticking)await new Promise(r=>setTimeout(r,20));let resumed=false;return ()=>{if(!resumed){resumed=true;suspended--;}};},close(){closed=true;clearInterval(timer);inhibit(false);}};
}
