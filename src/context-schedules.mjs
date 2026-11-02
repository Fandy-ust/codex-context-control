import {createHash,randomUUID} from 'node:crypto';
import {normalizeTaskSettings} from './core/task-settings.mjs';
import {contextError} from './context-operations.mjs';

const waiting=new Set(['waiting_for_turn','waiting_context','waiting_quota']);
const live=s=>waiting.has(s.state)||['dispatching','running'].includes(s.state);
const publicValue=({prompt,settings,fingerprint,...s})=>structuredClone(s);

// One-shot handoffs run inside the existing task-queue tick and persistence.
// There is deliberately no timer, runtime process or automatic retry here.
export function createContextSchedules({saved=[],save=()=>{},thread,start,interrupt=async()=>{},quota,gate,monitoring=()=>true,canDispatch=()=>true,operation=()=>null,now=Date.now,id=randomUUID}={}){
 const records=new Map();
 for(const original of Array.isArray(saved)?saved:[]){
  if(!original||typeof original.id!=='string'||typeof original.chatId!=='string')continue;
  const value=structuredClone(original);
  if(live(value))Object.assign(value,{state:waiting.has(value.state)?'cancelled':'outcome_unknown',reason:'service_restarted',updatedAt:now()});
  records.set(value.id,value);
 }
 const update=(value,patch)=>{if(Object.entries(patch).some(([k,v])=>JSON.stringify(value[k])!==JSON.stringify(v))){Object.assign(value,patch,{updatedAt:now()});save();}return publicValue(value);};
 const expire=s=>waiting.has(s.state)&&s.expiresAt<=now()?update(s,{state:'expired',reason:'handoff_deadline_elapsed'}):publicValue(s);
 function observe(chat){
  for(const s of records.values()){
   if(s.chatId!==chat.id||!waiting.has(s.state))continue;
   expire(s);if(!waiting.has(s.state))continue;
   if(!chat.connected||chat.ambiguous||chat.archived||chat.ephemeral||chat.canAcceptDirectInput===false){update(s,{state:'cancelled',reason:'connection_changed'});continue;}
   const b=s.basis;
   if(chat.model!==b.model||(chat.policy?.revision??0)!==b.policyRevision||(chat.contextEpoch??0)!==b.contextEpoch||(chat.inputEpoch??0)!==b.inputEpoch){update(s,{state:'cancelled',reason:'user_or_context_changed'});continue;}
   if(chat.lastCompletedTurnId===b.turnId){
    if(chat.lastTurnStatus!=='completed'){update(s,{state:'cancelled',reason:'source_turn_did_not_complete'});continue;}
    if(!s.sourceCompleted)update(s,{sourceCompleted:true,state:'waiting_context',reason:null});
   }
  }
 }
 return {
  snapshot:()=>structuredClone([...records.values()]),
  list(chatId){return [...records.values()].filter(s=>chatId==null||s.chatId===chatId).map(expire).reverse();},
  hasPending(){return [...records.values()].some(s=>live(s));},
  blocks(chatId){return [...records.values()].some(s=>s.chatId===chatId&&live(s));},
  observe,
  cancelWaiting(chatId,reason){for(const s of records.values())if((chatId==null||s.chatId===chatId)&&waiting.has(s.state))update(s,{state:'cancelled',reason});},
  cancel(chatId,scheduleId){const s=records.get(scheduleId);if(!s||s.chatId!==chatId)throw contextError('SCHEDULE_NOT_FOUND','Scheduled handoff not found for this chat.');if(['dispatching','running'].includes(s.state))throw contextError('ALREADY_STARTED','The continuation has started; use Codex Stop to interrupt that turn.','stop_running_turn');return waiting.has(s.state)?update(s,{state:'cancelled',reason:'user_cancelled'}):publicValue(s);},
  schedule({id:chatId,prompt,requestId,afterOperation=null,settings,expectedRevision}){
   if(typeof requestId!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(requestId))throw contextError('INVALID_REQUEST_ID','A stable request ID is required.','fix_request');
   if(typeof prompt!=='string'||!prompt.trim()||prompt.length>16000)throw contextError('INVALID_ARGUMENT','Provide a 1–16000 character task checkpoint.','fix_request');
   const fingerprint=createHash('sha256').update(JSON.stringify({prompt:prompt.trim(),afterOperation})).digest('hex');
   const previous=[...records.values()].find(s=>s.chatId===chatId&&s.requestId===requestId);
   if(previous){if(previous.fingerprint!==fingerprint)throw contextError('REQUEST_ID_CONFLICT','This request ID already identifies a different handoff.','use_new_request_id');return expire(previous);}
   if(!monitoring())throw contextError('MONITORING_PAUSED','Global monitoring is paused; no automatic continuation was registered.','ask_user');
   const chat=thread(chatId);
   if(!chat?.connected||chat.ambiguous||chat.archived||chat.ephemeral||chat.canAcceptDirectInput===false||!['active','inProgress'].includes(chat.status)||!chat.turnId)throw contextError('ACTIVE_CHAT_REQUIRED','Schedule from the active chat before ending its turn.','inspect_chat');
   if(expectedRevision!=null&&expectedRevision!==(chat.policy?.revision??0))throw contextError('REVISION_CONFLICT','Budget changed; reread the chat before scheduling.','refresh_chat');
   if(this.blocks(chatId))throw contextError('SCHEDULE_PENDING','A continuation is already scheduled for this chat.','inspect_schedules');
   if(afterOperation){
    const op=operation(chatId,afterOperation);
    if(!op||!['budget','compact'].includes(op.kind)||['failed','cancelled','superseded','expired','outcome_unknown'].includes(op.state)||op.kind==='budget'&&(op.state==='completed'||op.revision!=null&&op.revision!==(chat.policy?.revision??0))||op.kind==='compact'&&(op.turnId!==chat.turnId||op.inputEpoch!=null&&op.inputEpoch!==(chat.inputEpoch??0)))throw contextError('INVALID_DEPENDENCY','Choose the current budget application or this turn\'s explicit compaction request. Save-only or stale operations cannot prepare a handoff.','inspect_operations');
   }
   while(records.size>=50){const old=[...records.values()].find(s=>!live(s));if(!old)throw contextError('SCHEDULE_LIMIT','Too many active handoffs.','inspect_schedules');records.delete(old.id);}
   const value={id:id(),chatId,requestId,fingerprint,prompt:prompt.trim(),afterOperation,settings:normalizeTaskSettings(settings),basis:{turnId:chat.turnId,model:chat.model,policyRevision:chat.policy?.revision??0,contextEpoch:chat.contextEpoch??0,inputEpoch:chat.inputEpoch??0,accountScope:quota.state().accountScope??null},state:'waiting_for_turn',sourceCompleted:false,createdAt:now(),updatedAt:now(),expiresAt:now()+15*60*1000};
   records.set(value.id,value);save();return publicValue(value);
  },
  async tick(){
   for(const s of records.values()){
    if(!live(s))continue;
    const chat=thread(s.chatId);
    if(!chat){update(s,{state:'cancelled',reason:'chat_missing'});continue;}
    if(['dispatching','running'].includes(s.state)){
     const owned=chat.automaticTask;
     if(owned?.executionId===s.executionId&&['completed','error','interrupted'].includes(owned.status))update(s,{state:owned.status==='completed'?'completed':owned.status==='interrupted'?'cancelled':owned.errorConfirmed?'failed':'outcome_unknown',reason:owned.error??owned.status});
     else if(!chat.connected||chat.ambiguous||owned?.executionId!==s.executionId)update(s,{state:'outcome_unknown',reason:'execution_ownership_changed'});
     else if(monitoring()&&owned.status==='running'&&gate(s.settings.quota,quota.state(),now()).hard&&!s.interruptRequested){update(s,{interruptRequested:true,reason:'quota_guard'});try{await interrupt(s.chatId,s.executionId);}catch{update(s,{reason:'interrupt_outcome_unknown'});}}
     continue;
    }
    observe(chat);if(!waiting.has(s.state))continue;
    const scope=quota.state().accountScope;
    if(s.basis.accountScope&&scope&&scope!==s.basis.accountScope){update(s,{state:'cancelled',reason:'account_changed'});continue;}
    if(!s.sourceCompleted)continue;
    let compactionOperationId=null;
    if(s.afterOperation){
     let op;try{op=operation(s.chatId,s.afterOperation);}catch{update(s,{state:'cancelled',reason:'context_operation_missing'});continue;}
     if(['failed','cancelled','superseded','expired','outcome_unknown'].includes(op.state)){update(s,{state:'cancelled',reason:'context_operation_'+op.state});continue;}
     if(op.kind==='budget'&&op.state==='completed'){update(s,{state:'cancelled',reason:'budget_not_applied'});continue;}
     if(op.kind==='compact'&&op.state==='completed')compactionOperationId=op.id;
     if(!['completed','confirmed','awaiting_readback'].includes(op.state)){update(s,{state:'waiting_context',reason:'context_operation_pending'});continue;}
    }
    const budgetLoaded=!chat.policy||chat.policy.enabled===false||chat.revision===chat.policy.revision&&(['confirmed','awaiting_runtime_confirmation'].includes(chat.phase)||compactionOperationId&&chat.appliedBudget?.model===chat.model);
    if(!budgetLoaded||canDispatch(s.chatId)!==true||chat.status!=='idle'||['compacting','reloading','extension_pending','error','needs_compaction'].includes(chat.phase)){update(s,{state:'waiting_context',reason:'context_not_ready'});continue;}
    const quotaGate=gate(s.settings.quota,quota.state(),now());if(!quotaGate.valid||quotaGate.blocked){update(s,{state:'waiting_quota',reason:!quotaGate.valid?'quota_unknown':'quota_reserve'});continue;}
    const executionId=id();update(s,{state:'dispatching',executionId,reason:null});
    try{
     const receipt=await start(s.chatId,{executionId,taskId:s.id,prompt:s.prompt,settings:s.settings,schedule:{id:s.id,compactionOperationId,sourceTurnId:s.basis.turnId,inputEpoch:s.basis.inputEpoch,contextEpoch:s.basis.contextEpoch,model:s.basis.model,policyRevision:s.basis.policyRevision}});
     if(receipt?.status==='error')update(s,{state:receipt.errorCode==='SCHEDULE_CHANGED'?'cancelled':receipt.errorConfirmed?'failed':'outcome_unknown',reason:receipt.error??'start_failed'});
     else update(s,{state:receipt?.status==='completed'?'completed':'running',turnId:receipt?.turnId??null});
    }catch(error){update(s,{state:error.code==='SCHEDULE_CHANGED'?'cancelled':'outcome_unknown',reason:error.message});}
   }
  }
 };
}
