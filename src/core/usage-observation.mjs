// Numeric evidence from the exact, bounded history being resumed. Any newer
// input, model response, compaction, rollback or unfinished turn invalidates it.
export function localUsageObservation(events){
  let model=null,lastUsage=null,observedWindow=null,pending=false;
  for(const event of events){
    const p=event.payload??{};
    if(event.type==='turn_context'){
      if(model&&p.model&&model!==p.model)lastUsage=null;
      model=p.model??model;
    }
    if(event.type==='response_item'||event.type==='compacted')lastUsage=null;
    if(event.type!=='event_msg')continue;
    if(p.type==='task_started'){pending=true;lastUsage=null;}
    if(['task_complete','turn_complete','turn_aborted'].includes(p.type))pending=false;
    if(['thread_rolled_back','thread_rollback'].includes(p.type))lastUsage=null;
    if(p.type==='thread_settings_applied'&&p.thread_settings?.model&&p.thread_settings.model!==model){model=p.thread_settings.model;lastUsage=null;}
    if(p.type==='token_count'&&Number.isSafeInteger(p.info?.last_token_usage?.total_tokens)&&p.info.last_token_usage.total_tokens>=0){
      lastUsage={totalTokens:p.info.last_token_usage.total_tokens};
      observedWindow=p.info.model_context_window??null;
    }
  }
  return {known:!!model&&!!lastUsage&&!pending,model,lastUsage,observedWindow};
}
