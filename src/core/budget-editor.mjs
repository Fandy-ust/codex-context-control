import {calculateBudget,savedBudget} from './budget.mjs';
import {normalizePolicy} from './policy.mjs';

// Shared thread-editor constraints. Final acceptance always uses core/policy.
export function threadDraftLimits(model,window,reserve=16000){
  const percent=model?.effective_context_window_percent,maximum=model?.max_context_window;
  if(!Number.isInteger(percent)||percent<1||percent>100||!Number.isSafeInteger(maximum))return null;
  const raw=Math.ceil(window*100/percent),usable=Math.floor(maximum*percent/100/1000)*1000;
  const ceiling=model.context_ceiling==null?Infinity:model.context_ceiling-Math.max(16000,reserve);
  return {maximum:usable,compact:Math.max(1000,Math.floor(Math.min(window,raw*.9,model.context_compact_ceiling??Infinity,ceiling)/1000)*1000)};
}
export function threadDraft(thread){
  const model=thread?.modelMetadata,limit=threadDraftLimits(model,2000);if(!limit||limit.maximum<2000)return null;
  const budget=savedBudget(thread.policy,model),reserve=thread.policy?.reserve??16000;
  const window=Math.max(2000,Math.floor(Math.min(budget?.usableWindow??(model.context_ceiling?(thread.observedWindow??920000):400000),limit.maximum)/1000)*1000);
  const maximum=threadDraftLimits(model,window,reserve).compact;
  const compact=Math.max(1000,Math.min(maximum,Math.floor((budget?.compact??(model.context_ceiling?maximum:window*.9))/1000)*1000));
  return {window,compact,ratioWindow:window,ratioCompact:compact,reserve,retainedFloor:thread.policy?.retainedFloor??0,expectedRevision:thread.policy?.revision??0};
}
export function resizeThreadDraft(draft,window,model){
  const ratioWindow=draft.ratioWindow??draft.window,ratioCompact=draft.ratioCompact??draft.compact;
  const compact=ratioWindow>0?Number(BigInt(ratioCompact)*BigInt(window)/BigInt(ratioWindow)/1000n)*1000:1000;
  return {...draft,window,ratioWindow,ratioCompact,compact:Math.max(1000,Math.min(compact,threadDraftLimits(model,window,draft.reserve).compact))};
}
export function policyForThreadDraft(draft,model,thread=null){
  if(thread?.ambiguous)throw Error('检测到多个接入进程，请完整重启 Codex');
  if(draft.window<2000)throw Error('窗口至少为 2K，压缩阈值至少为 1K');
  const limit=threadDraftLimits(model,draft.window,draft.reserve),budget=calculateBudget({usableWindow:draft.window,compactPercent:1},model);
  if(!limit||model.context_catalog_ready===false)throw Error('请先在 Codex 打开此聊天，或重开 Codex 使上下文设置生效。');
  if(draft.compact<1000||draft.compact>limit.compact)throw Error('压缩阈值需保留下一轮输入余量');
  return normalizePolicy({window:budget.window,compact:draft.compact,reserve:draft.reserve,retainedFloor:draft.retainedFloor,scope:'total'});
}
