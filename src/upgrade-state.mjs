import fs from 'node:fs';
import path from 'node:path';
import {readJSON,atomicJSON} from './paths.mjs';
import {replaceDirectory} from './install-layout.mjs';
const configurationFiles=['settings.json','state.json','language.json','context-extension.json','new-chat-defaults.json','runtime-fix.json','automatic-startup.json'];
// Keep one lightweight configuration snapshot, not another copy of the app,
// Node runtime, histories, or caches. Reinstalling the same version is a no-op.
export function prepareUpgrade({home,version}){
 const previous=readJSON(path.join(home,'code/package.json'),{})?.version??null;
 if(previous===version||!previous)return {from:previous,to:version};
 const recordFile=path.join(home,'upgrade.json'),record=readJSON(recordFile,{});
 if(record.from===previous&&record.to===version&&record.phase==='prepared')return {from:previous,to:version};
 replaceDirectory(path.join(home,'upgrade-backup'),stage=>{
  for(const name of configurationFiles){
   const source=path.join(home,name);if(!fs.existsSync(source))continue;
   const stat=fs.lstatSync(source);if(!stat.isFile()||stat.isSymbolicLink())throw Error('升级配置文件无效：'+name);
   const data=fs.readFileSync(source);JSON.parse(data.toString('utf8'));fs.writeFileSync(path.join(stage,name),data,{mode:0o600});
  }
  atomicJSON(path.join(stage,'manifest.json'),{from:previous,to:version,createdAt:Date.now()});
 });
 atomicJSON(recordFile,{from:previous,to:version,phase:'prepared',preparedAt:Date.now()});
 return {from:previous,to:version};
}
export function inheritedSettings(previous,installation){return {...previous,...installation};}
export function completeUpgrade({home,from,to}){
 atomicJSON(path.join(home,'upgrade.json'),{from,to,phase:'complete',completedAt:Date.now()});
}
