import {parse} from 'smol-toml';
import {isDeepStrictEqual} from 'node:util';

// Codex's desktop bootstrap replaces /^notify\s*=/, but does not recognize
// quoted TOML keys. Restoring an old "notify" would cause it to append a
// second, duplicate notify on reopen. Change spelling only, never the command.
export function prepareConfigRestore(source) {
 const original=parse(source);
 if(!Object.hasOwn(original,'notify'))return source;
 let marker='__context_restore_notify__';
 while(Object.hasOwn(original,marker))marker+='_';
 const keys=/^([ \t]*)("(?:\\.|[^"\\\r\n])*"|'[^'\r\n]*')([ \t]*=)/gm;
 for(const match of source.matchAll(keys)){
  let key;
  try{key=Object.keys(parse(match[2]+' = 0'))[0];}catch{continue;}
  if(key!=='notify')continue;
  const start=match.index+match[1].length,end=start+match[2].length;
  const replace=name=>source.slice(0,start)+name+source.slice(end);
  // Parsing a probe identifies the actual root assignment without mistaking
  // lookalikes in multiline strings, nested tables or comments for that key.
  let probe;
  try{probe=parse(replace(marker));}catch{continue;}
  if(!Object.hasOwn(probe,marker))continue;
  const normalized=replace('notify');
  if(!isDeepStrictEqual(parse(normalized),original))throw Error('恢复配置兼容处理改变了配置内容，已停止恢复');
  return normalized;
 }
 return source;
}
