import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
function atomicJSON(file,value){fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const stage=file+'.'+crypto.randomBytes(6).toString('hex')+'.tmp';try{fs.writeFileSync(stage,JSON.stringify(value),{mode:0o600,flag:'wx'});fs.renameSync(stage,file);}finally{fs.rmSync(stage,{force:true});}}
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
 return {...model,context_window:Math.min(CEILING_RAW_WINDOW,Math.ceil((model.context_window??model.max_context_window??272000)*oldPercent/CEILING_PERCENT)),max_context_window:CEILING_RAW_WINDOW,effective_context_window_percent:CEILING_PERCENT,context_ceiling:MAX_CONTEXT_INPUT,context_compact_ceiling:MAX_CONTEXT_COMPACT};
}
export function prepareContextCatalog({home=process.env.CONTEXT_CONTROL_CODEX_HOME||process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),control=process.env.CONTEXT_CONTROL_HOME||path.join(os.homedir(),'Library/Application Support/CodexContextControl'),enabled=process.env.CONTEXT_CONTROL_CONTEXT_CEILING!=='0'&&(!process.env.CONTEXT_CONTROL_CATALOG_PATH||process.env.CONTEXT_CONTROL_CONTEXT_CEILING==='1')}={}){
 if(!enabled)return null;
 const source=process.env.CONTEXT_CONTROL_CATALOG_PATH||path.join(home,'models_cache.json');
 try{
  const data=JSON.parse(fs.readFileSync(source));if(!Array.isArray(data.models)||!data.models.length)return null;
  const models=data.models.map(model=>{const extended=ceilingModel(model);delete extended.context_ceiling;delete extended.context_compact_ceiling;return extended;});
  const catalog={models},hash=crypto.createHash('sha256').update(JSON.stringify(catalog)).digest('hex').slice(0,20);
  const file=path.join(control,'catalogs',`context-920k-${hash}.json`);
  if(!fs.existsSync(file))atomicJSON(file,catalog);
  return {file,version:CONTEXT_CEILING_VERSION,args:['-c',`model_catalog_json=${JSON.stringify(file)}`,'-c',`model_context_window=${CEILING_RAW_WINDOW}`,'-c',`model_auto_compact_token_limit=${MAX_CONTEXT_COMPACT}`,'-c','model_auto_compact_token_limit_scope="total"','-c','model_post_turn_compact_threshold_percent=100']};
 }catch{return null;}
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
