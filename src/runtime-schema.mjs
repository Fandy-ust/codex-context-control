import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

// This command exports compiled protocol definitions and exits. It never
// initializes an app-server connection, reads accounts or fetches model lists.
export async function inspectRuntimeSchema({command,env,cwd,extraArgs=[],run=spawnSync}){
  const output=path.join(cwd,'protocol');
  const result=run(command,['app-server','generate-json-schema','--experimental','--out',output],{env,cwd,windowsHide:true,encoding:'utf8',timeout:8000,maxBuffer:1024*1024});
  if(result.error||result.status!==0)throw Object.assign(Error('本地协议检查失败'),{code:'probe-schema-export-failed'});
  const schema=JSON.parse(fs.readFileSync(path.join(output,'ClientRequest.json'),'utf8'));
  const methods=new Set((schema.oneOf??[]).flatMap(entry=>entry.properties?.method?.enum??[]));
  for(const method of ['initialize','config/read','thread/start','thread/resume','thread/fork','thread/unsubscribe','thread/settings/update','thread/compact/start','turn/start'])if(!methods.has(method))throw Object.assign(Error('本地协议缺少 '+method),{code:'probe-schema-incompatible'});
  const resume=JSON.parse(fs.readFileSync(path.join(output,'v2/ThreadResumeParams.json'),'utf8'));
  if(!resume.properties?.config||!resume.properties?.threadId)throw Object.assign(Error('本地协议缺少预算配置入口'),{code:'probe-schema-incompatible'});
  const types={model_catalog_json:'string',model_context_window:'number',model_auto_compact_token_limit:'number',model_auto_compact_token_limit_scope:'string',model_post_turn_compact_threshold_percent:'number'};
  for(let i=0;i<extraArgs.length;i+=2){
    const assignment=extraArgs[i+1],equal=assignment?.indexOf('=')??-1,name=assignment?.slice(0,equal);
    if(extraArgs[i]!=='-c'||equal<1||!Object.hasOwn(types,name))throw Object.assign(Error('无法核对预算配置项'),{code:'probe-schema-incompatible'});
    const value=JSON.parse(assignment.slice(equal+1));
    if(typeof value!==types[name])throw Object.assign(Error('预算配置类型错误'),{code:'probe-schema-incompatible'});
  }
  return {evidence:'local-schema'};
}
