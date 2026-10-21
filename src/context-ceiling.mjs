import {ACCOUNTING_WINDOW_LIMIT} from './core/compaction-compensation.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
function atomicJSON(file,value){fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const stage=file+'.'+crypto.randomBytes(6).toString('hex')+'.tmp';try{fs.writeFileSync(stage,JSON.stringify(value),{mode:0o600,flag:'wx'});fs.renameSync(stage,file);}finally{fs.rmSync(stage,{force:true});}}
import {ceilingModel,CONTEXT_CEILING_VERSION,CEILING_RAW_WINDOW,MAX_CONTEXT_COMPACT} from './core/context-window.mjs';
export * from './core/context-window.mjs';
export function contextExtensionEnabled(control){try{return JSON.parse(fs.readFileSync(path.join(control,'context-extension.json'))).enabled===true;}catch{return false;}}
function compensationEnabled(control){try{return JSON.parse(fs.readFileSync(path.join(control,'compaction-compensation.json'))).enabled===true;}catch{return false;}}
export function prepareContextCatalog({home=process.env.CONTEXT_CONTROL_CODEX_HOME||process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),control=process.env.CONTEXT_CONTROL_HOME||path.join(os.homedir(),'Library/Application Support/CodexContextControl'),enabled=process.env.CONTEXT_CONTROL_CONTEXT_CEILING==='1'||(process.env.CONTEXT_CONTROL_CONTEXT_CEILING!=='0'&&!process.env.CONTEXT_CONTROL_CATALOG_PATH&&contextExtensionEnabled(control)),compensation=compensationEnabled(control)}={}){
 if(!enabled&&!compensation)return null;
 const source=process.env.CONTEXT_CONTROL_CATALOG_PATH||path.join(home,'models_cache.json');
 try{
  const data=JSON.parse(fs.readFileSync(source));if(!Array.isArray(data.models)||!data.models.length)return null;
  const models=data.models.map(model=>{const extended=enabled?ceilingModel(model):{...model,context_window:model.context_window??model.max_context_window};if(compensation&&Number.isSafeInteger(extended.context_window)&&extended.context_window>0)extended.max_context_window=Math.max(extended.max_context_window??0,ACCOUNTING_WINDOW_LIMIT);delete extended.context_ceiling;delete extended.context_compact_ceiling;delete extended.native_effective_context_window_percent;return extended;});
  const catalog={models},hash=crypto.createHash('sha256').update(JSON.stringify(catalog)).digest('hex').slice(0,20);
  const file=path.join(control,'catalogs',`context-${enabled?'920k':'native'}-${hash}.json`);
  if(!fs.existsSync(file))atomicJSON(file,catalog);
  return {file,version:enabled?CONTEXT_CEILING_VERSION:null,accountingWindowLimit:compensation?ACCOUNTING_WINDOW_LIMIT:null,args:enabled?['-c',`model_catalog_json=${JSON.stringify(file)}`,'-c',`model_context_window=${CEILING_RAW_WINDOW}`,'-c',`model_auto_compact_token_limit=${MAX_CONTEXT_COMPACT}`,'-c','model_auto_compact_token_limit_scope="total"','-c','model_post_turn_compact_threshold_percent=100']:['-c',`model_catalog_json=${JSON.stringify(file)}`]};
 }catch{return null;}
}
// Clap's global config vector can be replaced by the subcommand occurrence.
// Put every caller override in the same trailing group, then our ceiling values.
export function contextCeilingLaunchArgs(args,ceiling){
 if(!ceiling)return args;
 const positional=[],overrides=[];
 for(let i=0;i<args.length;i++){
  if(args[i]==='-c'||args[i]==='--config'){
   if(i+1>=args.length)throw Error('Codex config argument is missing its value');
   overrides.push(args[i],args[++i]);
  }else if(args[i].startsWith('--config='))overrides.push(args[i]);
  else positional.push(args[i]);
 }
 return [...positional,...overrides,...ceiling.args];
}
