import {savedBudget} from './budget.mjs';
import {preflight} from './policy.mjs';

export function contextSnapshot(thread,{deferredCompaction=false,operations=[],schedules=[]}={}){
  const target=savedBudget(thread.policy,thread.modelMetadata),fresh=(thread.usageFresh??thread.freshUsage)===true,used=thread.lastUsage?.totalTokens;
  const compensated=thread.compensation?.status==='active',extra=compensated?thread.compensation.extraTokens:0;
  const runtimeWindow=thread.expectedWindow??thread.observedWindow??null,window=compensated?thread.compensation.targetWindow:runtimeWindow,compact=thread.appliedBudget?.compact!=null?thread.appliedBudget.compact-extra:null,reserve=thread.appliedBudget?.reserve??thread.policy?.reserve??16000;
  const available=thread.connected===true&&!thread.ambiguous&&!thread.ephemeral&&thread.canAcceptDirectInput!==false;
  return {id:thread.id,name:thread.name??null,model:thread.model??null,status:thread.status,connected:thread.connected,phase:thread.phase,
    requested:target?{revision:thread.policy.revision,window:target.usableWindow,compact:target.compact,reserve:thread.policy.reserve,enabled:thread.policy.enabled}:null,
    loaded:{revision:thread.revision??null,window,compact,confirmed:thread.phase==='confirmed'},
    accounting:{automatic:thread.compensation?.automatic===true,known:compensated,extraTokens:compensated?extra:null,runtimeWindow,runtimeCompact:thread.appliedBudget?.compact??null},
    observation:{totalTokens:Number.isSafeInteger(used)?used:null,observedAt:thread.observedAt??null,validForPreflight:fresh,kind:thread.connected?'runtime':'cached',observedWindow:thread.observedWindow??null},
    headroom:{estimated:true,valid:fresh&&Number.isSafeInteger(used),toWindow:fresh&&Number.isSafeInteger(used)&&window!=null?window-used-reserve:null,toCompaction:fresh&&Number.isSafeInteger(used)&&compact!=null?compact-used-reserve:null,reserve},
    limits:thread.modelMetadata??null,actions:{applyNow:available&&thread.status==='idle',compactNow:available&&thread.status==='idle',compactWhenIdle:available&&deferredCompaction},operations:operations.slice(0,5),schedules:schedules.slice(0,5)};
}

export function contextPreflight(thread,policy,model){
  const original=preflight(thread,policy,model),assessed=preflight({...thread,status:'idle'},policy,model);
  const invalid=['above_catalog_maximum','above_safe_compact','below_retained_floor','unsupported_thread'];
  const blockers=[];if(thread.status==='active'||thread.status==='inProgress')blockers.push('waiting_for_idle');
  if(thread.ambiguous)blockers.push('connection_conflict');else if(!thread.connected)blockers.push('waiting_bridge');
  if(!assessed.allowed)blockers.push(assessed.code);
  return {...original,allowed:blockers.length===0,...Object.fromEntries(['expectedWindow','effectiveCompact','estimatedUsage','catalogMaximum','usablePercent','expansionOnly'].filter(k=>Object.hasOwn(assessed,k)).map(k=>[k,assessed[k]])),
    budgetValid:assessed.code==='metadata_missing'?null:!invalid.includes(assessed.code),evidence:{sufficient:assessed.allowed||assessed.code==='needs_compaction',usageIsEstimate:assessed.usageIsEstimate,observedAt:thread.observedAt??null},
    basis:{policyRevision:thread.policy?.revision??0,turnId:thread.turnId??null,model:thread.model??null,observedAt:thread.observedAt??null},
    proposal:{window:assessed.expectedWindow??null,compact:assessed.effectiveCompact??null,reserve:policy.reserve},
    execution:{canExecuteNow:blockers.length===0,when:blockers.length===0?'now':blockers.every(b=>b==='waiting_for_idle')?'idle':'blocked',blockers},registered:false};
}
