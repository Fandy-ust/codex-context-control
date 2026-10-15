export const verifiedVersions=['0.159.2','0.160.0'];
export function runtimeSupported(text){return verifiedVersions.includes(text.match(/codex-cli\s+([0-9.]+)/)?.[1]);}
export function isStdioServer(args){
  if(!args.includes('app-server')||['generate-json-schema','generate-ts','daemon'].some(x=>args.includes(x)))return false;
  const at=args.indexOf('--listen');const inline=args.find(x=>x.startsWith('--listen='));
  const endpoint=at>=0?args[at+1]:inline?.slice('--listen='.length);
  return endpoint==null||endpoint==='stdio://';
}
