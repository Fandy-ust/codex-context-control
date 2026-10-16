import {policyForModel} from './context-ceiling.mjs';
import {clampNewChatDefaults} from './new-chat-defaults.mjs';
// Disabling imposes a temporary native ceiling. Explicit edits while disabled
// invalidate only the corresponding saved value, so user changes always win.
export function transitionExtensionBudgets({policies,defaults,restore},enabled,modelFor,defaultModel){
 const snapshot=enabled?restore:{policies:structuredClone(policies),defaults:structuredClone(defaults)};
 const nextPolicies={};
 for(const [id,current] of Object.entries(policies)){
  const saved=enabled?snapshot?.policies?.[id]:null;
  const source=saved?{...saved,enabled:current.enabled,revision:current.revision}:current;
  const next=policyForModel(source,modelFor(id),{revise:false});
  const changed=next.window!==current.window||next.compact!==current.compact||next.effectivePercent!==current.effectivePercent||next.contextCeilingVersion!==current.contextCeilingVersion;
  nextPolicies[id]=changed?{...next,revision:current.revision+1,updatedAt:Date.now()}:next;
 }
 const candidate=clampNewChatDefaults(enabled?snapshot?.defaults??defaults:defaults,defaultModel);
 const changed=candidate.usableWindow!==defaults.usableWindow||candidate.compact!==defaults.compact;
 const nextDefaults=changed?{...candidate,revision:defaults.revision+1,updatedAt:Date.now()}:defaults;
 return {policies:nextPolicies,defaults:nextDefaults,restore:enabled?null:snapshot};
}
