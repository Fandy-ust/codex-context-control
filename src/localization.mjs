import fs from 'node:fs';
import path from 'node:path';
import {root} from './paths.mjs';
import {resolveLanguage,translate} from './localization-core.mjs';
export {resolveLanguage} from './localization-core.mjs';
const english=JSON.parse(fs.readFileSync(new URL('./locales/en.json',import.meta.url),'utf8'));
export function languagePreference(home=root){try{const value=JSON.parse(fs.readFileSync(path.join(home,'language.json'),'utf8')).selection;return ['auto','zh','en'].includes(value)?value:'auto';}catch{return 'auto';}}
export function localize(text,{selection=languagePreference(),timeZone}={}){return translate(text,english,resolveLanguage(selection,timeZone));}
export function L(key,...args){return localize(key).replace(/\{(\d+)\}/g,(full,n)=>args[n]??full);}
