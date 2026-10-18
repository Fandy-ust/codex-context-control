export function tokenNumber(value, name='token 数') {
  if(typeof value==='string') {
    const match=value.trim().match(/^(\d+(?:\.\d+)?)\s*([kKmM]?)$/);
    if(!match)throw new Error(`${name}请输入整数或 400K 这样的数值`);
    value=Number(match[1])*({k:1000,m:1000000}[match[2].toLowerCase()]||1);
  }
  if(!Number.isSafeInteger(value)||value<0)throw new Error(`${name}必须是非负整数`);
  return value;
}
export function normalizePolicy(input) {
  const window=tokenNumber(input.window,'窗口');if(window<1000)throw new Error('窗口至少为 1,000 tokens');
  const compact=tokenNumber(input.compact??Math.floor(window*.8),'压缩阈值');if(compact<1)throw new Error('压缩阈值必须大于零');
  const reserve=tokenNumber(input.reserve??16000,'下一轮预留');
  const retainedFloor=tokenNumber(input.retainedFloor??0,'必须保留量');
  if(input.scope&&input.scope!=='total')throw new Error('首版仅支持 total 计数，以便可靠地预检缩小操作');
  return {window,compact,reserve,retainedFloor,scope:'total'};
}
export function preflight(thread,policy,model) {
  const result={code:'ready',allowed:true,notes:[],usageIsEstimate:true};
  const percent=model?.effective_context_window_percent;
  const maximum=model?.max_context_window;
  if(!Number.isInteger(percent)||percent<1||percent>100) return {...result,code:'metadata_missing',allowed:false,message:'缺少该模型的可用比例，暂不应用。'};
  if(!Number.isSafeInteger(maximum)||maximum<1)return {...result,code:'metadata_missing',allowed:false,message:'缺少该模型的目录上限，暂不应用。'};
  if(policy.window>maximum)return {...result,code:'above_catalog_maximum',allowed:false,message:`超过当前模型目录上限 ${maximum.toLocaleString()}；这不代表服务端接受边界。`};
  if(model.context_ceiling&&policy.compact>model.context_ceiling-Math.max(16000,policy.reserve))return {...result,code:'above_safe_compact',allowed:false,message:'920K 上限模式必须为下一轮保留至少 16K；请降低压缩阈值。'};
  const usable=Math.floor(policy.window*percent/100);
  const compact=Math.min(policy.compact,Math.floor(policy.window*90/100));
  Object.assign(result,{expectedWindow:usable,effectiveCompact:compact,catalogMaximum:maximum,usablePercent:percent});
  if(compact!==policy.compact)result.notes.push(`total 模式下实际阈值最多为 ${compact.toLocaleString()}。`);
  if(policy.retainedFloor+policy.reserve>=Math.min(usable,compact))return {...result,code:'below_retained_floor',allowed:false,message:'必须保留量加下一轮预留已达到容量或压缩阈值；需要更大的窗口或减少保留量。'};
  if(thread?.status==='active'||thread?.status==='inProgress')return {...result,code:'waiting_for_idle',allowed:false,message:'本轮仍在运行，已排队等待轮次结束。'};
  if(thread?.ephemeral||thread?.canAcceptDirectInput===false)return {...result,code:'unsupported_thread',allowed:false,message:'临时会话或由父代理管理的会话暂不支持重新加载。'};
  // Reloading identical history invalidates window confirmation, not its last
  // measured usage. Older bridges only provide freshUsage.
  const usage=(thread?.usageFresh??thread?.freshUsage)?thread?.lastUsage?.totalTokens:null;
  if(!Number.isSafeInteger(usage))return {...result,code:'needs_observation',allowed:false,message:'等待本轮请求的用量记录，再判断能否安全调整。'};
  result.estimatedUsage=usage;
  if(usage+policy.reserve>=Math.min(usable,compact))return {...result,code:'needs_compaction',allowed:false,message:'最近请求用量加预留已达到新阈值；请先在 Codex 压缩，再重新测量。'};
  result.message='预检通过；将在下一轮前重新加载该聊天。';return result;
}
