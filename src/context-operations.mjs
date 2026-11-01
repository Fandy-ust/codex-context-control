import {randomUUID} from 'node:crypto';

const copy=({fingerprint,...value})=>structuredClone(value);
const terminal=new Set(['confirmed','completed','failed','cancelled','superseded','expired','outcome_unknown']);
export const contextError=(code,message,nextAction='inspect_state')=>Object.assign(Error(message),{code,nextAction});

// One-shot, persisted receipts. Reconnects never replay uncertain mutations.
export function createContextOperations({load=()=>[],save=()=>{},now=Date.now,id=randomUUID,limit=200}={}){
  const records=new Map(load().map(value=>[value.id,value]));
  const persist=()=>save([...records.values()]);
  for(const value of records.values())if(!terminal.has(value.state))Object.assign(value,{state:value.state==='waiting_for_idle'?'cancelled':'outcome_unknown',reason:'service_restarted',updatedAt:now()});
  if(records.size)persist();
  function update(value,patch){if(Object.entries(patch).every(([key,next])=>JSON.stringify(value[key])===JSON.stringify(next)))return copy(value);Object.assign(value,patch,{updatedAt:now()});persist();return copy(value);}
  function expire(value){if(value.kind==='compact'&&value.state==='waiting_for_idle'&&value.expiresAt<=now())update(value,{state:'expired',reason:'idle_deadline_elapsed'});return value;}
  function get(operationId,threadId){const value=records.get(operationId);if(!value||value.threadId!==threadId)throw contextError('OPERATION_NOT_FOUND','Operation not found for this chat.');return copy(expire(value));}
  return {
    get,
    list(threadId){return [...records.values()].filter(v=>v.threadId===threadId).map(v=>copy(expire(v))).reverse();},
    replay(threadId,requestId,fingerprint){
      if(typeof requestId!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(requestId))throw contextError('INVALID_REQUEST_ID','Use a 1–128 character request ID containing letters, digits or ._:-.','fix_request');
      const previous=[...records.values()].find(v=>v.threadId===threadId&&v.requestId===requestId);
      if(previous&&previous.fingerprint!==fingerprint)throw contextError('REQUEST_ID_CONFLICT','This request ID already identifies a different action.','use_new_request_id');
      return previous?copy(expire(previous)):null;
    },
    create(input){
      const existing=this.replay(input.threadId,input.requestId,input.fingerprint);if(existing)return existing;
      while(records.size>=limit){const old=[...records.values()].find(v=>terminal.has(expire(v).state));if(!old)throw contextError('OPERATION_LIMIT','Too many pending operations.','inspect_operations');records.delete(old.id);}
      const value={...input,id:id(),state:'accepted',createdAt:now(),updatedAt:now(),...(input.kind==='compact'?{expiresAt:now()+15*60*1000}:{})};records.set(value.id,value);persist();return copy(value);
    },
    transition(operationId,threadId,patch){const value=records.get(operationId);get(operationId,threadId);if(terminal.has(value.state))return copy(value);return update(value,patch);},
    cancel(operationId,threadId){const value=records.get(operationId);get(operationId,threadId);if(terminal.has(value.state))return copy(value);if(value.kind!=='compact'||!['accepted','waiting_for_idle'].includes(value.state))throw contextError('NOT_CANCELLABLE','Only a compaction request that has not started can be cancelled.','inspect_operation');return update(value,{state:'cancelled',reason:'user_cancelled'});},
    pending(threadId){return this.list(threadId).filter(v=>!terminal.has(v.state));},
    observe(thread){
      for(const value of records.values()){
        if(value.threadId!==thread.id||terminal.has(expire(value).state))continue;
        const revision=thread.policy?.revision??0;
        if(value.kind==='budget'){
          if(value.revision!=null&&revision!==value.revision){update(value,{state:'superseded',reason:'budget_changed'});continue;}
          if(thread.revision===value.revision&&thread.phase==='confirmed')update(value,{state:'confirmed'});
          else if(thread.revision===value.revision&&thread.phase==='awaiting_runtime_confirmation')update(value,{state:'awaiting_readback'});
          else if(thread.phase==='error')update(value,{state:'failed',reason:thread.message});
          else if(['needs_observation','needs_compaction','waiting_bridge','connection_conflict','mismatch'].includes(thread.phase))update(value,{state:'blocked',reason:thread.phase});
          else if(thread.status==='active')update(value,{state:'waiting_for_idle'});
          else if(thread.phase==='reloading')update(value,{state:'executing'});
        }else if(value.state==='waiting_for_idle'){
          if((thread.turnId??null)!==value.turnId||thread.model!==value.model||revision!==value.revision||(thread.contextEpoch??0)!==(value.contextEpoch??0))update(value,{state:'superseded',reason:'chat_state_changed'});
          else if(thread.status==='idle'&&['interrupted','failed'].includes(thread.lastTurnStatus))update(value,{state:'cancelled',reason:'turn_did_not_complete'});
        }
      }
    }
  };
}
