import {calculateBudget,savedBudget} from './budget.mjs';
import {normalizePolicy} from './policy.mjs';

export function draftLimits(model,usableWindow,reserve=16000){
  if(!model||!Number.isInteger(model.effective_context_window_percent)||!Number.isSafeInteger(model.max_context_window))return null;
  const percent=model.effective_context_window_percent,maximum=Math.floor(model.max_context_window*percent/100/1000)*1000;
  const raw=Math.ceil(usableWindow*100/percent);
  return {maximum,compact:Math.max(0,Math.floor(Math.min(raw*.9,model.context_compact_ceiling??Infinity,usableWindow-reserve)/1000)*1000)};
}
export function threadDraft(thread){
  const model=thread?.modelMetadata,policy=thread?.policy,budget=savedBudget(policy,model);
  if(!model)return null;
  const maximum=draftLimits(model,1000)?.maximum;
  if(!maximum)return null;
  const window=Math.max(1000,Math.floor(Math.min(budget?.usableWindow??thread.observedWindow??Math.min(400000,maximum),maximum)/1000)*1000);
  const reserve=policy?.reserve??16000,limit=draftLimits(model,window,reserve);
  const compact=Math.min(Math.floor((budget?.compact??window*.9)/1000)*1000,limit.compact);
  return {window,compact,ratioCompact:budget?.compact??compact,ratioWindow:budget?.usableWindow??window,reserve,retainedFloor:policy?.retainedFloor??0,expectedRevision:policy?.revision??0};
}
export function resizeDraft(draft,window,model){
  const ratioCompact=draft.ratioCompact??draft.compact,ratioWindow=draft.ratioWindow??draft.window;
  const compact=ratioWindow>0?Number(BigInt(ratioCompact)*BigInt(window)/BigInt(ratioWindow)/1000n)*1000:0;
  return {...draft,ratioCompact,ratioWindow,window,compact:Math.min(compact,draftLimits(model,window,draft.reserve).compact)};
}
export function policyForDraft(draft,model){
  const budget=calculateBudget({usableWindow:draft.window,compactPercent:1},model),limit=draftLimits(model,draft.window,draft.reserve);
  if(draft.compact>limit.compact||draft.compact<1000)throw Error('压缩阈值超出允许范围，请检查下一轮预留。');
  return normalizePolicy({window:budget.window,compact:draft.compact,reserve:draft.reserve,retainedFloor:draft.retainedFloor,scope:'total'});
}
