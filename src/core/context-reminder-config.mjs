import {CONTEXT_ADJUSTMENT_GUIDANCE} from './context-adjustment-guidance.mjs';

export const CONTEXT_REMINDER_FIELDS=['context_tokens','observation_status','loaded_window','loaded_compact','reserve_tokens','headroom_tokens','pressure','catalog_ceiling','requested_window','requested_compact','budget_status','cli_path','chat_id','observation_time','context_tokens_raw','loaded_window_raw','loaded_compact_raw','reserve_tokens_raw','headroom_tokens_raw','catalog_ceiling_raw','requested_window_raw','requested_compact_raw'];
export const DEFAULT_REMINDER_CONFIG={
  prompt:CONTEXT_ADJUSTMENT_GUIDANCE,
  template:'[Context Manager status]\nLatest context estimate: {context_tokens} tokens ({observation_status}); observed at {observation_time}.\nLoaded usable window: {loaded_window}; loaded compaction threshold: {loaded_compact}; reserve: {reserve_tokens}.\nEstimated room after reserve: {headroom_tokens}; pressure: {pressure}. New tool output may not yet be counted.\nModel catalog usable ceiling: {catalog_ceiling} (not proof of server acceptance).\nSaved target: window {requested_window}, compact {requested_compact}; status: {budget_status}.',
  frequency:{minIntervalSeconds:5,intervalSeconds:30,toolCalls:6,growthTokens:20000,maxIntervalSeconds:120}
};
export function normalizeReminderConfig(input={}){
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Invalid reminder configuration');
  for(const key of Object.keys(input))if(!['prompt','template','frequency'].includes(key))throw Error('Unknown reminder configuration field: '+key);
  const config={...DEFAULT_REMINDER_CONFIG,...input,frequency:{...DEFAULT_REMINDER_CONFIG.frequency,...input.frequency}};
  for(const key of ['prompt','template']){
    if(typeof config[key]!=='string'||!config[key].trim()||config[key].length>12000)throw Error(key+' must contain 1–12000 characters');
    for(const match of config[key].matchAll(/\{([a-zA-Z_][a-zA-Z_0-9]*)\}/g))if(!CONTEXT_REMINDER_FIELDS.includes(match[1]))throw Error('Unknown reminder placeholder: '+match[1]);
  }
  if(input.frequency!=null&&(typeof input.frequency!=='object'||Array.isArray(input.frequency)))throw Error('Invalid reminder frequency');
  const bounds={minIntervalSeconds:[0,3600],intervalSeconds:[0,3600],toolCalls:[1,1000],growthTokens:[0,1000000],maxIntervalSeconds:[1,3600]};
  for(const [key,value] of Object.entries(config.frequency)){
    const bound=bounds[key];if(!Object.hasOwn(bounds,key)||!Number.isSafeInteger(value)||value<bound[0]||value>bound[1])throw Error('Invalid reminder frequency: '+key);
  }
  if(config.frequency.minIntervalSeconds>config.frequency.intervalSeconds||config.frequency.intervalSeconds>config.frequency.maxIntervalSeconds)throw Error('Reminder intervals must satisfy minimum ≤ regular ≤ maximum');
  return {...config,frequency:{...config.frequency}};
}
export function renderReminderConfig(config,values,{includePrompt=true}={}){
  // This is plain text substitution, never evaluation of code or shell input.
  return renderReminderText(config.template,values)+(includePrompt?'\n\n'+renderReminderText(config.prompt,values):'');
}
export function renderReminderText(text,values){
  return text.replace(/\{([a-zA-Z_][a-zA-Z_0-9]*)\}/g,(_,key)=>String(values[key]??'unknown'));
}
export function contextRemindersEnabledFor(state,id){
  return state?.enabled===true&&(state.allChats===true
    ? !state.excludedChatIds?.includes(id)
    : state.enabledChatIds?.includes(id)===true);
}
