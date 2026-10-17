// Projection for statistics only. Preserve event ordinals and every field used
// by snapshot/timeline accounting; source rollout files are never modified.
// Keep this whitelist in step with context-statistics.mjs and its equivalence tests.
const pick=(value,keys)=>Object.fromEntries(keys.filter(k=>Object.hasOwn(value??{},k)).map(k=>[k,value[k]]));
const content=value=>Array.isArray(value)?value.map(part=>pick(part,['type','text'])):value;
function item(value){
 const result=pick(value,['id','type']);
 if(value?.type==='message'){
  Object.assign(result,pick(value,['role','phase','channel']));result.content=content(value.content);
  if(value.internal_chat_message_metadata_passthrough)result.internal_chat_message_metadata_passthrough=pick(value.internal_chat_message_metadata_passthrough,['content_item_kinds','turn_id']);
 }else if(['function_call','custom_tool_call'].includes(value?.type))Object.assign(result,pick(value,['name','namespace','arguments','input']));
 else if(['function_call_output','custom_tool_call_output'].includes(value?.type))result.output=content(value.output);
 return result;
}
export function statisticsEvent(event){
 const p=event.payload??{};let payload;
 switch(event.type){
  case 'session_meta':payload=pick(p,['history_base']);if(p.base_instructions?.text)payload.base_instructions={text:p.base_instructions.text};break;
  case 'turn_context':payload=pick(p,['turn_id','model','effort','reasoning_effort','service_tier']);break;
  case 'response_item':payload=item(p);break;
  case 'token_usage_record':payload=pick(p,['response_id','turn_id','usage']);break;
  case 'compacted':payload=pick(p,['message','window_id','compaction_response_id']);if(Array.isArray(p.replacement_history))payload.replacement_history=p.replacement_history.map(item);break;
  case 'event_msg':
   payload={type:p.type};
   if(p.type==='task_started')Object.assign(payload,pick(p,['turn_id','model_context_window']));
   if(p.type==='token_count')payload.info=pick(p.info,['model_context_window']);
   if(p.type==='thread_settings_applied')payload.thread_settings=pick(p.thread_settings,['model','reasoning_effort','service_tier']);
   if(p.type==='item_completed'){
    Object.assign(payload,pick(p,['started_at_ms','completed_at_ms']));payload.item=pick(p.item,['id','type']);
   }
   break;
  default:payload={};
 }
 return {...pick(event,['type','timestamp','originThreadId']),payload};
}
