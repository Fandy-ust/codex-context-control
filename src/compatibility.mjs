// Recognize the runtime, without maintaining a version allowlist.
export function runtimeSupported(text=''){return /^codex-cli\s+\d+\.\d+\.\d+(?:[-+][\w.-]+)?\s*$/.test(text.trim());}
export function isStdioServer(args){
  if(!args.includes('app-server')||['generate-json-schema','generate-ts','daemon','proxy','help'].some(x=>args.includes(x)))return false;
  const at=args.indexOf('--listen');const inline=args.find(x=>x.startsWith('--listen='));
  const endpoint=at>=0?args[at+1]:inline?.slice('--listen='.length);
  return endpoint==null||endpoint==='stdio://';
}
