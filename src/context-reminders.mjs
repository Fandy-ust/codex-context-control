import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {root,codexHome,readJSON,atomicJSON,settings} from './paths.mjs';
import {editOwnedHooks} from './hooks.mjs';
import {contextSnapshot} from './core/context-snapshot.mjs';
import {queueCLIPath} from './cli-launcher.mjs';
import {normalizeReminderConfig,renderReminderText,CONTEXT_REMINDER_FIELDS,contextRemindersEnabledFor} from './core/context-reminder-config.mjs';
import {CONTEXT_REMINDER_STATUS,reminderDigest} from './context-hook-receipt.mjs';

export const CONTEXT_REMINDER_EVENTS=['UserPromptSubmit','PostToolUse','PostCompact'];
const quote=(value,platform)=>{
  if(/[\r\n\0]/.test(value))throw Error('Invalid hook command path');
  if(platform==='win32')return "'"+value.replaceAll("'","''")+"'";
  return "'"+value.replaceAll("'","'\\''")+"'";
};
export function contextReminderCommand({home=root,node=settings().node||process.execPath,codeRoot=fileURLToPath(new URL('../',import.meta.url)),platform=process.platform}={}){
  const command=[node,path.join(codeRoot,'src/context-reminder-hook.mjs'),home].map(value=>quote(value,platform)).join(' ');
  // Codex uses PowerShell for Windows command hooks. A quoted executable
  // without the call operator is a string expression, not a command.
  return platform==='win32'?'& '+command:command;
}

// Hooks are informational only: no new turns, budget changes or compactions.
export function createContextReminders({home=root,codex=codexHome,command=()=>contextReminderCommand({home}),now=Date.now}={}){
  const file=path.join(home,'context-reminders.json'),hooksFile=path.join(codex,'hooks.json');
  const logFile=path.join(home,'context-management-log.json');
  const chats=new Map(),notifications=[];let lastHookAt=null,lastReminderAt=null,reminderCount=0,error=null;
  let audit,saveTimer;
  function logEntries(){
    if(!audit){let saved;try{saved=readJSON(logFile,[]);}catch{/* A damaged debug log must not block chat operations. */}audit=Array.isArray(saved)?saved.filter(entry=>entry&&typeof entry.chatId==='string').slice(-500):[];}
    return audit;
  }
  function flushLog(){
    if(!saveTimer)return;
    clearTimeout(saveTimer);saveTimer=null;
    try{atomicJSON(logFile,logEntries());}catch(error){process.stderr.write('Context Manager: '+error.message+'\n');}
  }
  function logEvent(chatId,event){
    const entries=logEntries();entries.push({id:randomUUID(),chatId,...event,at:now()});if(entries.length>500)entries.shift();
    scheduleLogSave();
  }
  function scheduleLogSave(){
    if(!saveTimer){saveTimer=setTimeout(flushLog,1000);saveTimer.unref();}
  }
  function confirmHook({id,turnId,event,digests,failed},thread){
    if(!CONTEXT_REMINDER_EVENTS.includes(event)||!contextRemindersEnabledFor(scope(read()),id)||thread.ephemeral||thread.canAcceptDirectInput===false)return;
    if(failed===true){logEvent(id,{kind:'hook-error',trigger:event});return;}
    if(!Array.isArray(digests)||digests.length>8)return;
    const match=logEntries().findLast(entry=>entry.chatId===id&&entry.kind==='reminder'&&entry.turnId===turnId&&
      entry.hookEvent===event&&entry.delivery==='returned'&&digests.includes(entry.digest));
    if(match){match.delivery='accepted';scheduleLogSave();}
  }
  const read=()=>readJSON(file,{});
  const enabled=()=>read().enabled===true;
  const scope=saved=>({enabled:saved.enabled===true,allChats:saved.allChats===true,
    enabledChatIds:Array.isArray(saved.enabledChatIds)?saved.enabledChatIds:[],excludedChatIds:Array.isArray(saved.excludedChatIds)?saved.excludedChatIds:[]});
  const freshNotification=event=>now()-event.at<=60000;
  function status(){const saved=read(),on=saved.enabled===true;return {...scope(saved),operationNotifications:saved.operationNotifications===true,hasOperationNotifications:saved.operationNotifications===true&&notifications.some(freshNotification),config:normalizeReminderConfig(saved.config),revision:saved.revision??0,placeholders:CONTEXT_REMINDER_FIELDS,lastHookAt,lastReminderAt,reminderCount,error,
    phase:!on?'disabled':error?'error':lastHookAt?'receiving_hooks':'awaiting_hook',
    message:!on?'上下文提醒已关闭':error?'提醒 Hook 配置失败，请关闭后重试':lastHookAt?'已收到提醒 Hook；按上下文变化补充状态':'已开启；请在 Codex 审核并信任 Hook，新会话加载后生效'};}
  function setEnabled(value){
    if(typeof value!=='boolean')throw Error('开关值无效');
    const previous=read(),nextCommand=value?command():previous.command??'';
    if(!value){
      // Opt-out takes effect even if hooks.json has since become malformed or
      // read-only; existing runtimes must immediately stop receiving notices.
      atomicJSON(file,{...previous,enabled:false,updatedAt:now()});
      chats.clear();lastHookAt=lastReminderAt=null;error=null;
      try{
        if(previous.command)editOwnedHooks({file:hooksFile,home,command:previous.command,remove:true,events:CONTEXT_REMINDER_EVENTS});
        const {command:oldCommand,...retained}=previous;atomicJSON(file,{...retained,enabled:false,updatedAt:now()});
      }catch(e){error=e.message;}
      return status();
    }
    // First-time disable must not create hooks.json or touch unrelated hooks.
    const beforeHooks=fs.existsSync(hooksFile)?fs.readFileSync(hooksFile):null;
    if(value||previous.command){
      editOwnedHooks({file:hooksFile,home,command:nextCommand,previousCommand:previous.command,remove:!value,events:CONTEXT_REMINDER_EVENTS,timeout:2,statusMessage:CONTEXT_REMINDER_STATUS});
    }
    const installedHooks=fs.existsSync(hooksFile)?fs.readFileSync(hooksFile):null;
    try{atomicJSON(file,{...previous,enabled:value,...(value?{command:nextCommand}:{}),updatedAt:now()});}
    catch(e){
      const current=fs.existsSync(hooksFile)?fs.readFileSync(hooksFile):null;
      if(current?.equals(installedHooks)||!current&&!installedHooks){if(beforeHooks)fs.writeFileSync(hooksFile,beforeHooks);else fs.rmSync(hooksFile,{force:true});}
      throw e;
    }
    chats.clear();lastHookAt=lastReminderAt=null;error=null;return status();
  }
  function reconcile(){if(!enabled())return status();try{return setEnabled(true);}catch(e){error=e.message;return status();}}
  function setOperationNotifications(value){
    if(typeof value!=='boolean')throw Error('开关值无效');
    atomicJSON(file,{...read(),operationNotifications:value,updatedAt:now()});
    if(!value)notifications.length=0;
    return status();
  }
  function notifyOperation(chatId,event){
    logEvent(chatId,event);
    try{queueNotification(read(),event);}catch{/* A notification preference never changes an operation receipt. */}
  }
  function queueNotification(saved,event){
    if(saved.operationNotifications!==true)return;
    notifications.push({...event,at:now()});
    if(notifications.length>32)notifications.shift();
  }
  function takeOperationNotifications(){
    const events=notifications.splice(0);
    return {events:read().operationNotifications===true?events.filter(freshNotification):[]};
  }
  function setAllChats(value){
    if(typeof value!=='boolean')throw Error('开关值无效');
    const saved=read(),previous=scope(saved),next={...previous,allChats:value};
    if(value&&!previous.enabled)throw Error('请先开启全局上下文提醒');
    if(previous.allChats!==value){
      atomicJSON(file,{...saved,allChats:value,updatedAt:now()});
      for(const id of chats.keys())if(!contextRemindersEnabledFor(next,id))chats.delete(id);
    }
    return status();
  }
  function setChatEnabled(id,value){
    if(typeof id!=='string'||!id||id.length>256||typeof value!=='boolean')throw Error('无效的聊天开关');
    const saved=read();
    if(value&&saved.enabled!==true)throw Error('请先开启全局上下文提醒');
    const current=scope(saved),key=current.allChats?'excludedChatIds':'enabledChatIds';
    const ids=new Set(current[key]),listed=current.allChats?!value:value;
    if(ids.has(id)!==listed){
      if(listed)ids.add(id);else ids.delete(id);
      atomicJSON(file,{...saved,[key]:[...ids],updatedAt:now()});
      chats.delete(id);
    }
    return status();
  }
  function configure(input,expectedRevision){
    const previous=read();
    if(expectedRevision!=null&&expectedRevision!==(previous.revision??0))throw Object.assign(Error('Reminder settings changed; reload before saving.'),{code:'REVISION_CONFLICT'});
    const config=normalizeReminderConfig(input);atomicJSON(file,{...previous,config,revision:(previous.revision??0)+1,updatedAt:now()});
    // Apply edits on the next new event without forgetting that a compaction
    // invalidated an earlier usage measurement.
    for(const chat of chats.values())chat.forceReminder=true;
    return status();
  }
  function preview(input,thread){
    const config=normalizeReminderConfig(input??read().config);
    return {text:notice(config,thread??{id:'preview-chat'},now(),false,0).text,placeholders:CONTEXT_REMINDER_FIELDS};
  }
  function notice(config,thread,time,afterCompact,invalidatedAt,includePrompt=true){
    const snap=contextSnapshot(thread),observation=snap.observation,used=afterCompact?null:observation.totalTokens;
    const fresh=!afterCompact&&observation.validForPreflight&&thread.usageObservedAt!=null&&thread.usageObservedAt>Math.max(invalidatedAt,thread.usageInvalidatedAt??0)&&time-thread.usageObservedAt<=120000;
    const metadata=thread.modelMetadata,ceiling=metadata?.context_ceiling??(Number.isSafeInteger(metadata?.max_context_window)&&Number.isInteger(metadata?.effective_context_window_percent)?Math.floor(metadata.max_context_window*metadata.effective_context_window_percent/100):null);
    const capacityKnown=Number.isSafeInteger(snap.loaded.window)&&Number.isSafeInteger(snap.loaded.compact)&&Number.isSafeInteger(ceiling)&&snap.loaded.window<=ceiling;
    const room=fresh&&capacityKnown&&snap.headroom.valid?Math.min(...[snap.headroom.toWindow,snap.headroom.toCompaction].filter(Number.isFinite)):null;
    const pressure=Number.isFinite(room)?room<=16000?'critical':room<=50000?'low':'normal':'unknown';
    const numeric={context_tokens:used,loaded_window:snap.loaded.window,loaded_compact:snap.loaded.compact,reserve_tokens:snap.headroom.reserve,headroom_tokens:room,catalog_ceiling:ceiling,requested_window:snap.requested?.window,requested_compact:snap.requested?.compact};
    const values=Object.fromEntries(Object.entries(numeric).flatMap(([key,value])=>[[key,Number.isSafeInteger(value)?value.toLocaleString('en-US'):'unknown'],[key+'_raw',Number.isSafeInteger(value)?String(value):'null']]));
    Object.assign(values,{pressure,observation_status:afterCompact?'invalidated by compaction; await a new usage observation':fresh?'recent observation; not an exact current input count':'stale or unavailable',observation_time:thread.usageObservedAt?new Date(thread.usageObservedAt).toISOString():'unknown',budget_status:!snap.requested?'none':snap.loaded.confirmed&&snap.requested.revision===snap.loaded.revision?'confirmed':'not confirmed',cli_path:queueCLIPath(home),chat_id:thread.id});
    const planner=includePrompt?renderReminderText(config.prompt,values):null,statusText=renderReminderText(config.template,values);
    return {text:statusText+(planner==null?'':'\n\n'+planner),planner,used,pressure,budget:JSON.stringify([snap.loaded,snap.requested])};
  }
  function hook(event,thread){
    const saved=read();
    if(!CONTEXT_REMINDER_EVENTS.includes(event.hook_event_name)||!thread?.connected||!contextRemindersEnabledFor(scope(saved),thread.id)||thread.ambiguous||thread.ephemeral||thread.canAcceptDirectInput===false)return {};
    // Subagent events may carry the parent's session_id. Never use parent data
    // for another agent, another turn or a changed model.
    if(event.session_id!==thread.id||event.agent_id&&event.agent_id!==thread.id||event.turn_id&&event.turn_id!==thread.turnId||event.model&&event.model!==thread.model)return {};
    const time=now(),kind=event.hook_event_name;lastHookAt=time;
    const last=chats.get(thread.id),previous=last?.turnId===thread.turnId?last:null;
    const invalidatedAt=kind==='PostCompact'?time:last?.invalidatedAt??0;
    const config=normalizeReminderConfig(saved.config),frequency=config.frequency;
    const task=thread.automaticTask;
    const continuation=task?.scheduleId&&(task.status==='starting'&&task.submitted===true||task.status==='running'&&task.turnId===thread.turnId);
    const includePrompt=!last||kind==='PostCompact'||kind==='UserPromptSubmit'&&!continuation&&previous?.promptTurnId!==thread.turnId;
    const rendered=notice(config,thread,time,kind==='PostCompact',invalidatedAt,includePrompt),{used,pressure,budget}=rendered;
    if(previous&&event.tool_use_id&&previous.seen.includes(event.tool_use_id))return {};
    const calls=(previous?.calls??0)+1;
    const changed=previous?.budget!==budget||previous?.pressure!==pressure;
    const elapsed=time-(previous?.sentAt??0),growth=Number.isSafeInteger(used)&&Number.isSafeInteger(previous?.used)?used-previous.used:0;
    const trigger=kind!=='PostToolUse'?kind:!previous?'first':previous.forceReminder?'settings':
      elapsed>=frequency.minIntervalSeconds*1000&&changed?'state':
      elapsed>=frequency.intervalSeconds*1000&&frequency.growthTokens>0&&growth>=frequency.growthTokens?'growth':
      elapsed>=frequency.intervalSeconds*1000&&calls>=frequency.toolCalls?'calls':
      elapsed>=frequency.maxIntervalSeconds*1000?'interval':null;
    const seen=[...(previous?.seen??[]),...(event.tool_use_id?[event.tool_use_id]:[])].slice(-64);
    if(!trigger){chats.set(thread.id,{...previous,calls,seen});return {};}
    if(chats.size>=128&&!chats.has(thread.id))chats.delete(chats.keys().next().value);
    chats.set(thread.id,{turnId:thread.turnId,calls:0,seen,sentAt:time,used,budget,pressure,invalidatedAt,promptTurnId:includePrompt?thread.turnId:previous?.promptTurnId});
    lastReminderAt=time;reminderCount++;
    const auditEvent={kind:'reminder',used,includePrompt,trigger,...(trigger==='growth'?{growth}:{})};
    logEvent(thread.id,{...auditEvent,delivery:'returned',turnId:thread.turnId,hookEvent:kind,digest:reminderDigest(rendered.text),
      ...(includePrompt?{planner:rendered.planner.slice(0,16000),plannerTruncated:rendered.planner.length>16000}:{} )});
    queueNotification(saved,auditEvent);
    return {hookSpecificOutput:{hookEventName:kind,additionalContext:rendered.text}};
  }
  return {enabled,status,setEnabled,setAllChats,setChatEnabled,setOperationNotifications,notifyOperation,takeOperationNotifications,
    log:id=>logEntries().filter(entry=>entry.chatId===id).slice(-50).reverse().map(({digest,...entry})=>entry),flushLog,reconcile,configure,preview,defaults:()=>({config:normalizeReminderConfig()}),hook,confirmHook};
}
