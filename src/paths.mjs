import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {defaultRoot,ipcEndpoint,privateDirectory,windows,desktopInstallation} from './platform/index.mjs';

export const root = process.env.CONTEXT_CONTROL_HOME || defaultRoot();
export const codexHome = process.env.CONTEXT_CONTROL_CODEX_HOME || process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
// Unix-domain socket paths have a short OS limit; the home directory remains private.
export const socketPath = ipcEndpoint(root);
export function ensureRoot() { privateDirectory(root); }
export function ipcKey(create=false){
  if(!windows)return null;
  const file=path.join(root,'ipc-key');
  if(create){ensureRoot();try{fs.writeFileSync(file,crypto.randomBytes(32).toString('hex'),{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}}
  const key=fs.readFileSync(file,'utf8');if(!/^[a-f0-9]{64}$/.test(key))throw Error('Invalid local IPC key');return key;
}
export function readJSON(file, fallback=null) { try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(error){if(error.code==='ENOENT')return fallback;throw error;} }
export function atomicJSON(file, data) {
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  const tmp=`${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {fs.writeFileSync(tmp,JSON.stringify(data,null,2)+'\n',{mode:0o600,flag:'wx'});fs.renameSync(tmp,file);}
  finally {try{fs.unlinkSync(tmp);}catch{}}
}
export function settings() {return readJSON(path.join(root,'settings.json'),{});}
export function realBinary() {
  const explicit=process.env.CONTEXT_CONTROL_REAL_CODEX;if(explicit)return explicit;
  const selected=settings().realBinary;
  if(selected&&(!windows||fs.existsSync(selected)))return selected;
  if(windows){const desktop=desktopInstallation();if(desktop)return desktop.binary;const cli=path.join(process.env.LOCALAPPDATA||'','Programs/OpenAI/Codex/bin/codex.exe');if(fs.existsSync(cli))return cli;}
  for(const app of ['ChatGPT','Codex']) {
    const p=`/Applications/${app}.app/Contents/Resources/codex-cli/bin/codex`;
    if(fs.existsSync(p))return p;
  }
  throw new Error('未找到 Codex 运行时，请先运行安装程序。');
}
