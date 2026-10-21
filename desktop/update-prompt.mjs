import {newerVersion} from '../src/core/update-artifact.mjs';
// Keep prompt decisions separate from Electron so startup and manual checks share behavior.
export function createUpdatePrompt({enabled,setEnabled,check,install,prompt,currentVersion,changed=()=>{}}){
 let pending;
 async function perform(automatic){
  if(automatic&&!enabled())return null;
  const update=await check();
  if(automatic&&!enabled())return update;
  if(!update?.available||!newerVersion(update.version,currentVersion?.()??update.currentVersion)||['downloading','installing'].includes(update.phase))return update;
  const choice=await prompt(update);
  if(choice==='disable'){await setEnabled(false);changed();}
  if(choice==='install'){const result=await install();changed();return result;}
  return update;
 }
 return {run(automatic=false){if(pending)return pending;pending=perform(automatic).finally(()=>{pending=null;});return pending;}};
}
