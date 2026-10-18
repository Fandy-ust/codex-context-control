export const CONTEXT_CEILING_VERSION=1;
export const MAX_CONTEXT_INPUT=920000;
export const MIN_CONTEXT_RESERVE=16000;
// Matching the native 90% compaction factor keeps total-mode thresholds usable
// up to the visible window. No native binary patch is needed.
export const CEILING_PERCENT=90;
export const CEILING_RAW_WINDOW=Math.ceil(MAX_CONTEXT_INPUT*100/CEILING_PERCENT);
export const MAX_CONTEXT_COMPACT=MAX_CONTEXT_INPUT-MIN_CONTEXT_RESERVE;
export function ceilingModel(model){
 if(!model)return null;
 const oldPercent=model.effective_context_window_percent??95;
 return {...model,context_window:Math.min(CEILING_RAW_WINDOW,Math.ceil((model.context_window??model.max_context_window??272000)*oldPercent/CEILING_PERCENT)),max_context_window:CEILING_RAW_WINDOW,effective_context_window_percent:CEILING_PERCENT,native_effective_context_window_percent:model.native_effective_context_window_percent??oldPercent,context_ceiling:MAX_CONTEXT_INPUT,context_compact_ceiling:MAX_CONTEXT_COMPACT};
}
export function migrateCeilingPolicy(policy,originalModel){
 if(!policy||policy.contextCeilingVersion===CONTEXT_CEILING_VERSION)return policy;
 const percent=policy.effectivePercent??originalModel?.effective_context_window_percent;
 if(!Number.isInteger(percent))throw Error('Cannot preserve budget without original model percentage');
 const usable=Math.min(MAX_CONTEXT_INPUT,Math.floor(policy.window*percent/100));
 const window=Math.ceil(usable*100/CEILING_PERCENT);
 const compact=Math.min(policy.compact,Math.floor(window*.9),MAX_CONTEXT_INPUT-Math.max(policy.reserve??MIN_CONTEXT_RESERVE,MIN_CONTEXT_RESERVE));
 return {...policy,window,compact,revision:policy.revision+1,effectivePercent:CEILING_PERCENT,contextCeilingVersion:CONTEXT_CEILING_VERSION,updatedAt:Date.now()};
}
export function ceilingConfig(config={}){
 const result={...config,model_auto_compact_token_limit_scope:'total',model_post_turn_compact_threshold_percent:100};
 result.model_context_window=Math.min(Number.isSafeInteger(config.model_context_window)&&config.model_context_window>=1000?config.model_context_window:CEILING_RAW_WINDOW,CEILING_RAW_WINDOW);
 result.model_auto_compact_token_limit=Math.min(Number.isSafeInteger(config.model_auto_compact_token_limit)&&config.model_auto_compact_token_limit>0?config.model_auto_compact_token_limit:MAX_CONTEXT_COMPACT,MAX_CONTEXT_COMPACT);
 return result;
}

export function policyForModel(policy,model,{revise=true}={}){
 if(!policy||!model)return policy;
 const percent=model.effective_context_window_percent,maximum=model.max_context_window;
 if(!Number.isInteger(percent)||percent<1||!Number.isSafeInteger(maximum))return policy;
 const previousPercent=policy.effectivePercent??(policy.contextCeilingVersion?CEILING_PERCENT:model.native_effective_context_window_percent??percent);
 const usable=Math.min(Math.floor(policy.window*previousPercent/100),Math.floor(maximum*percent/100));
 const window=Math.min(maximum,Math.ceil(usable*100/percent));
 const compact=Math.min(policy.compact,Math.floor(window*.9),model.context_ceiling?MAX_CONTEXT_INPUT-Math.max(policy.reserve??16000,16000):Number.MAX_SAFE_INTEGER);
 const changed=window!==policy.window||compact!==policy.compact||!!policy.contextCeilingVersion!==!!model.context_ceiling;
 const result={...policy,window,compact,effectivePercent:percent,revision:policy.revision+(revise&&changed?1:0)};
 if(model.context_ceiling)result.contextCeilingVersion=CONTEXT_CEILING_VERSION;else delete result.contextCeilingVersion;
 if(changed&&revise)result.updatedAt=Date.now();
 return result;
}
