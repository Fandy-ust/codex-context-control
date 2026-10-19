import fs from 'node:fs';
import path from 'node:path';
const marker='Context Manager queue CLI';
const shQuote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const cmdPath=s=>{if(/["\r\n]/.test(s))throw Error('Invalid CLI launcher path');return s.replaceAll('%','%%');};
export function queueCLIPath(home,platform=process.platform){return path.join(home,'bin',platform==='win32'?'context-manager.cmd':'context-manager');}
export function installQueueCLI({home,node,codeRoot,platform=process.platform}){
 const file=queueCLIPath(home,platform),script=path.join(codeRoot,'src/cli.mjs');
 const content=platform==='win32'?`@echo off\r\nrem ${marker}\r\nsetlocal DisableDelayedExpansion\r\nset "CONTEXT_CONTROL_HOME=${cmdPath(home)}"\r\n"${cmdPath(node)}" "${cmdPath(script)}" %*\r\nexit /b %errorlevel%\r\n`:`#!/bin/sh\n# ${marker}\nexport CONTEXT_CONTROL_HOME=${shQuote(home)}\nexec ${shQuote(node)} ${shQuote(script)} "$@"\n`;
 fs.mkdirSync(path.dirname(file),{recursive:true});
 if(fs.existsSync(file)&&!fs.readFileSync(file,'utf8').includes(marker))throw Error('CLI launcher path is occupied by an unrelated file');
 const temporary=file+'.'+process.pid+'.tmp';try{fs.writeFileSync(temporary,content,{mode:0o700});fs.renameSync(temporary,file);if(platform!=='win32')fs.chmodSync(file,0o700);}finally{fs.rmSync(temporary,{force:true});}
 return file;
}
export function removeQueueCLI(home,platform=process.platform){const file=queueCLIPath(home,platform);try{if(fs.readFileSync(file,'utf8').includes(marker))fs.unlinkSync(file);}catch(error){if(error.code!=='ENOENT'&&error.code!=='EPERM'&&error.code!=='EACCES')throw error;}}
