import {normalizePolicy} from './policy.mjs';

export function inheritedForkPolicy(source,parentId){
  if(!source?.enabled||typeof parentId!=='string'||!parentId||!Number.isSafeInteger(source.revision)||source.revision<1)return null;
  return {...normalizePolicy(source),...(source.effectivePercent?{effectivePercent:source.effectivePercent}:{}),...(source.contextCeilingVersion?{contextCeilingVersion:source.contextCeilingVersion,effectivePercent:source.effectivePercent}:{}),revision:1,enabled:true,inheritedFrom:parentId,inheritedFromRevision:source.revision};
}

export function forkConfig(params,policy){
  return {...params,config:{...params.config,model_context_window:policy.window,model_auto_compact_token_limit:policy.compact,model_auto_compact_token_limit_scope:policy.scope}};
}
