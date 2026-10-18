import fs from 'node:fs';
import path from 'node:path';
import {root} from './paths.mjs';

export const integrationLogDirectory=process.env.CONTEXT_CONTROL_DIAGNOSTIC_DIRECTORY||path.join(root,'logs');
export function integrationLog(stage,details={}){
  try{
    const file=path.join(integrationLogDirectory,'integration.jsonl');fs.mkdirSync(integrationLogDirectory,{recursive:true});
    if(fs.existsSync(file)&&fs.statSync(file).size>1024*1024){fs.rmSync(file+'.1',{force:true});fs.renameSync(file,file+'.1');}
    // Call sites pass stage metadata, never RPC bodies, chat text or tokens.
    fs.appendFileSync(file,JSON.stringify({at:new Date().toISOString(),pid:process.pid,stage,...details})+'\n');
  }catch{/* Logs must not affect launching Codex. */}
}
