export const ACCOUNTING_WINDOW_LIMIT=16000000;

// Reproduce the runtime's heuristic, not the model's actual reasoning-token count.
export function reasoningEstimate(length) {
  if (!Number.isSafeInteger(length) || length < 0) throw Error('Invalid reasoning length');
  return Math.ceil(Math.max(Math.floor(length * 3 / 4) - 650, 0) / 4);
}

// A new user input creates a new instruction boundary. All retained reasoning
// can therefore contribute during that turn, including the previous response.
// Keep only lengths in the cache; encrypted payloads and conversation text are not retained.
export function projectCompensationEvent(event) {
  const p = event.payload ?? {};
  const item = value => ({type:value.type, id:value.id,
    ...(value.type === 'reasoning' ? {reasoningLength:typeof value.encrypted_content === 'string' ? new TextEncoder().encode(value.encrypted_content).length : 0} : {})});
  let payload = {};
  if (event.type === 'session_meta') payload = {history_base:p.history_base};
  if (event.type === 'response_item') payload = item(p);
  if (event.type === 'compacted') payload = {replacement_history:Array.isArray(p.replacement_history) ? p.replacement_history.map(item) : null};
  if (event.type === 'event_msg') payload = {type:p.type, turn_id:p.turn_id};
  return {type:event.type, originThreadId:event.originThreadId, payload};
}

export function activeReasoningEstimate(events, {threadId, completedTurnId} = {}) {
  let items = [], indices = new Map(), known = true, completed = null;
  const append = item => {
    if (!item || typeof item.type !== 'string') {known = false; return;}
    if (item.id && indices.has(item.id)) items[indices.get(item.id)] = item;
    else {if (item.id) indices.set(item.id, items.length); items.push(item);}
  };
  for (const event of events) {
    const p = event.payload ?? {};
    if (event.type === 'compacted') {
      items = []; indices = new Map(); known = Array.isArray(p.replacement_history);
      if (known) for (const item of p.replacement_history) append(item);
    } else if (event.type === 'response_item') append(p);
    else if (event.type === 'event_msg') {
      if (['thread_rolled_back','thread_rollback'].includes(p.type)) known = false;
      // Interrupted turns persist turn_aborted, not task_complete. Their retained
      // reasoning still needs compensation before the user's next input.
      if (['task_complete','turn_complete','turn_aborted'].includes(p.type) && (!threadId || event.originThreadId === threadId)) completed = p.turn_id;
    }
  }
  if (!known) return {known:false, reason:'history'};
  if (completedTurnId && completed !== completedTurnId) return {known:false, reason:'pending'};
  let extraTokens = 0;
  for (const item of items) if (item.type === 'reasoning') {
    if (!Number.isSafeInteger(item.reasoningLength)) return {known:false, reason:'history'};
    extraTokens += reasoningEstimate(item.reasoningLength);
    if (!Number.isSafeInteger(extraTokens)) return {known:false, reason:'history'};
  }
  return {known:true, extraTokens};
}

export function compensationBudget(policy, model, observation = {enabled:false}) {
  const percent = model?.effective_context_window_percent;
  const targetWindow = Number.isInteger(percent) ? Math.floor(policy.window * percent / 100) : null;
  const base = {window:policy.window, compact:policy.compact};
  const details = {enabled:observation.enabled === true, status:'off', extraTokens:0, targetWindow, runtimeWindow:targetWindow};
  if (!details.enabled) return {...base, details};
  if (!observation.known || !Number.isInteger(percent) || percent < 1 || percent > 100 || !Number.isSafeInteger(model?.max_context_window))
    return {...base, details:{...details,status:'unavailable',message:'等待完整历史，暂未补偿'}};
  const extra = observation.extraTokens;
  if (!Number.isSafeInteger(extra) || extra < 0) throw Error('Invalid compensation estimate');
  // The catalog maximum constrains the real policy, not the extra accounting
  // space. Enlarging this local counter never increases the displayed budget
  // or the bridge's independently enforced real-usage threshold.
  const requiredWindow = Math.max(policy.window, Math.ceil((targetWindow + extra) * 100 / percent), Math.ceil((policy.compact + extra) * 100 / 90));
  const accountingLimit=Math.max(model.max_context_window,observation.accountingWindowLimit??model.max_context_window);
  if (!Number.isSafeInteger(accountingLimit) || requiredWindow>accountingLimit || !Number.isSafeInteger(requiredWindow) || !Number.isSafeInteger(policy.compact + extra) || policy.window > model.max_context_window)
    return {...base, details:{...details,status:'limited',extraTokens:extra,message:'计数补偿空间不足，请重开 Codex 加载补偿目录'}};
  return {window:requiredWindow, compact:policy.compact + extra, details:{...details,status:'active',extraTokens:extra,runtimeWindow:Math.floor(requiredWindow * percent / 100),message:extra ? '已为历史推理估算预留空间' : '已开启，当前无需额外补偿'}};
}
