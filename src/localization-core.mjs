const zones=new Set(['Asia/Shanghai','Asia/Hong_Kong','Asia/Macau','Asia/Macao','Asia/Taipei','Asia/Chongqing','Asia/Chungking','Asia/Harbin','Asia/Urumqi','Asia/Kashgar','PRC','Hongkong','ROC']);
export function resolveLanguage(selection='auto',timeZone=Intl.DateTimeFormat().resolvedOptions().timeZone){return selection==='zh'||selection==='en'?selection:zones.has(timeZone)?'zh':'en';}
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),cache=new WeakMap();
const fill=(text,values)=>text.replace(/\{(\d+)\}/g,(full,n)=>values[n]??full);
function templates(dictionary){
  if(cache.has(dictionary))return cache.get(dictionary);
  const result=Object.entries(dictionary).filter(([k])=>/\{\d+\}/.test(k)).map(([source,target])=>{
    const indices=[];let offset=0,pattern='^';for(const match of source.matchAll(/\{(\d+)\}/g)){pattern+=escape(source.slice(offset,match.index))+'(.*?)';indices.push(Number(match[1]));offset=match.index+match[0].length;}
    return {source,target,indices,pattern:new RegExp(pattern+escape(source.slice(offset))+'$','s')};
  }).sort((a,b)=>b.source.length-a.source.length);cache.set(dictionary,result);return result;
}
export function translate(text,dictionary,language){
  if(typeof text!=='string'||language==='zh')return text;if(dictionary[text])return dictionary[text];if(!/\p{Script=Han}/u.test(text))return text;
  for(const item of templates(dictionary)){const match=item.pattern.exec(text);if(match){const values={};item.indices.forEach((key,n)=>values[key]=match[n+1]);return fill(item.target,values);}}
  return text.includes('\n')?text.split('\n').map(line=>translate(line,dictionary,language)).join('\n'):text;
}
