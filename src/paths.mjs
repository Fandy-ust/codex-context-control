import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

export const root = process.env.CONTEXT_CONTROL_HOME || path.join(os.homedir(), 'Library/Application Support/CodexContextControl');
export const codexHome = process.env.CONTEXT_CONTROL_CODEX_HOME || process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
// Unix-domain socket paths have a short OS limit; the home directory remains private.
export const socketPath = path.join(root, 'ipc.sock');
export function ensureRoot() { fs.mkdirSync(root, { recursive:true, mode:0o700 }); }
export function readJSON(file, fallback=null) { try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(error){if(error.code==='ENOENT')return fallback;throw error;} }
export function atomicJSON(file, data) {
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  const tmp=`${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {fs.writeFileSync(tmp,JSON.stringify(data,null,2)+'\n',{mode:0o600,flag:'wx'});fs.renameSync(tmp,file);}
  finally {try{fs.unlinkSync(tmp);}catch{}}
}
export function settings() {return readJSON(path.join(root,'settings.json'),{});}
export function realBinary() {
  const selected=process.env.CONTEXT_CONTROL_REAL_CODEX || settings().realBinary;
  if(selected)return selected;
  for(const app of ['ChatGPT','Codex']) {
    const p=`/Applications/${app}.app/Contents/Resources/codex-cli/bin/codex`;
    if(fs.existsSync(p))return p;
  }
  throw new Error('未找到 Codex 运行时，请先运行安装程序。');
}
