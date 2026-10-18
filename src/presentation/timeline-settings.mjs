import {modelDisplayName} from './chat.mjs';

export function timelineSpeedMode(value){
 if(value==='priority'||value==='fast')return 'fast';
 if(value==='default'||value==='standard')return 'standard';
 return typeof value==='string'&&value.length?value:null;
}
export function timelineSettingChanges(previous,current,responseIndex){
 if(!previous)return [];
 return ['model','effort','serviceTier'].flatMap(field=>{
  const normalize=value=>field==='serviceTier'?timelineSpeedMode(value):typeof value==='string'&&value.length?value:null;
  const from=normalize(previous[field]),to=normalize(current?.[field]);
  return from&&to&&from!==to?[{responseIndex,field,from,to}]:[];
 });
}
export function timelineSettingValue(field,value){
 if(field==='model')return modelDisplayName(value);
 if(field==='serviceTier')return value==='fast'?'⚡ Fast':value==='ultrafast'?'⚡⚡ Ultrafast':value==='standard'?'Standard':value;
 return value==='xhigh'?'XHigh':value.charAt(0).toUpperCase()+value.slice(1);
}
