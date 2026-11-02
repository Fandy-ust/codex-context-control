// Numeric evidence from the exact, bounded history being resumed. Any newer
// input, model response, compaction, rollback or unfinished turn invalidates it.
export function localUsageObservation(events){
  let model=null,provider=null,measuredModel=null,measuredProvider=null,lastUsage=null,observedWindow=null,pending=false;
  for(const event of events){
    const p=event.payload??{};
    if(event.type==='session_meta')provider=p.model_provider??provider;
    if(event.type==='turn_context'){
      if(model&&p.model&&model!==p.model)lastUsage=null;
      model=p.model??model;
      provider=p.model_provider_id??provider;
    }
    if(event.type==='response_item'||event.type==='compacted')lastUsage=null;
    if(event.type!=='event_msg')continue;
    if(p.type==='task_started'){pending=true;lastUsage=null;}
    if(['task_complete','turn_complete','turn_aborted'].includes(p.type))pending=false;
    if(['thread_rolled_back','thread_rollback'].includes(p.type))lastUsage=null;
    if(p.type==='thread_settings_applied'){
      // A desktop fork may select a default model and switch back before its
      // first request. Keep evidence bound to the measured model/provider;
      // settings alone do not add input or generate a response.
      model=p.thread_settings?.model??model;
      provider=p.thread_settings?.model_provider_id??provider;
    }
    if(p.type==='token_count'&&Number.isSafeInteger(p.info?.last_token_usage?.total_tokens)&&p.info.last_token_usage.total_tokens>=0){
      lastUsage={totalTokens:p.info.last_token_usage.total_tokens};
      measuredModel=model;measuredProvider=provider;
      observedWindow=p.info.model_context_window??null;
    }
  }
  const matches=model===measuredModel&&provider===measuredProvider;
  return {known:!!model&&!!lastUsage&&matches&&!pending,model,lastUsage:matches?lastUsage:null,observedWindow:matches?observedWindow:null};
}
