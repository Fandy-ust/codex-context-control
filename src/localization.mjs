import fs from 'node:fs';
import path from 'node:path';
import {root} from './paths.mjs';
const english=JSON.parse(fs.readFileSync(new URL('./locales/en.json',import.meta.url),'utf8'));
const chineseZones=new Set(['Asia/Shanghai','Asia/Hong_Kong','Asia/Macau','Asia/Macao','Asia/Taipei','Asia/Chongqing','Asia/Chungking','Asia/Harbin','Asia/Urumqi','Asia/Kashgar','PRC','Hongkong','ROC']);
export function resolveLanguage(selection='auto',timeZone=Intl.DateTimeFormat().resolvedOptions().timeZone){return selection==='zh'||selection==='en'?selection:chineseZones.has(timeZone)?'zh':'en';}
export function languagePreference(home=root){try{const value=JSON.parse(fs.readFileSync(path.join(home,'language.json'),'utf8')).selection;return ['auto','zh','en'].includes(value)?value:'auto';}catch{return 'auto';}}
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const templates=Object.entries(english).filter(([k])=>/\{\d+\}/.test(k)).map(([source,target])=>{
 const indices=[];let offset=0,pattern='^';
 for(const match of source.matchAll(/\{(\d+)\}/g)){pattern+=escape(source.slice(offset,match.index))+'(.*?)';indices.push(Number(match[1]));offset=match.index+match[0].length;}
 return {source,target,indices,pattern:new RegExp(pattern+escape(source.slice(offset))+'$','s')};
}).sort((a,b)=>b.source.length-a.source.length);
const fill=(text,values)=>text.replace(/\{(\d+)\}/g,(full,n)=>values[n]??full);
export function localize(text,{selection=languagePreference(),timeZone}={}){
 if(typeof text!=='string'||resolveLanguage(selection,timeZone)==='zh')return text;
 if(english[text])return english[text];
 if(!/\p{Script=Han}/u.test(text))return text;
 for(const item of templates){const match=item.pattern.exec(text);if(match){const values={};item.indices.forEach((key,n)=>values[key]=match[n+1]);return fill(item.target,values);}}
 return text.includes('\n')?text.split('\n').map(line=>localize(line,{selection,timeZone})).join('\n'):text;
}
export function L(key,...args){const translated=localize(key);return fill(translated,Object.fromEntries(args.map((value,n)=>[n,String(value)])));}
