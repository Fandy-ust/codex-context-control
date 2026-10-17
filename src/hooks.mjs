import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {atomicJSON} from './paths.mjs';

export function editOwnedHook({file,home,command,previousCommand=command,remove=false}){
  const before=fs.existsSync(file)?fs.readFileSync(file):null,doc=before?JSON.parse(before):{};
  if(!doc||typeof doc!=='object'||Array.isArray(doc)||doc.hooks!=null&&(typeof doc.hooks!=='object'||Array.isArray(doc.hooks)))throw Error('hooks.json 配置无效');
  const groups=doc.hooks?.Stop||[];if(!Array.isArray(groups))throw Error('Stop hooks 配置无效');
  const commands=new Set([command,previousCommand].filter(Boolean));
  const kept=groups.flatMap(group=>{if(!group?.hooks?.some(h=>h.type==='command'&&commands.has(h.command)))return [group];const hooks=group.hooks.filter(h=>h.type!=='command'||!commands.has(h.command));return hooks.length?[{...group,hooks}]:[];});
  if(!remove)kept.push({hooks:[{type:'command',command,timeout:2,statusMessage:'Context Control: reading this chat budget'}]});
  doc.hooks={...doc.hooks,Stop:kept};
  const backup=path.join(home,'backups',new Date().toISOString().replaceAll(':','-')+'-'+crypto.randomBytes(3).toString('hex'));fs.mkdirSync(backup,{recursive:true,mode:0o700});
  if(before)fs.writeFileSync(path.join(backup,'hooks.json'),before,{mode:0o600});
  if((fs.existsSync(file)?fs.readFileSync(file).toString('base64'):null)!==(before?before.toString('base64'):null))throw Error('hooks.json 在安装期间变化，已取消写入');
  atomicJSON(file,doc);
}
