// Recognize the runtime, without maintaining a version allowlist.
export function runtimeSupported(text=''){return /^codex-cli\s+\d+\.\d+\.\d+(?:[-+][\w.-]+)?\s*$/.test(text.trim());}
// Only wrap a command whose grammar and transport we understand. In particular,
// startup policy reads are short-lived commands even though they use app-server.
const globalValues=new Set(['-c','--config','--enable','--disable']);
const serverValues=new Set(['--listen','--code-mode-host','--cloud-skills-snapshot','--startup-client-info']);
const serverFlags=new Set(['--strict-config','--analytics-default-enabled','--stdio']);
export function classifyRuntimeCommand(args){
  let server=false,listen=null;
  for(let i=0;i<args.length;i++){
    const arg=args[i];
    if(typeof arg!=='string')return {stdio:false,reason:'invalid-argument'};
    const equal=arg.indexOf('='),name=equal<0?arg:arg.slice(0,equal);
    if(globalValues.has(name)||(server&&serverValues.has(name))){
      const value=equal<0?args[++i]:arg.slice(equal+1);
      if(typeof value!=='string'||!value||value.startsWith('-'))return {stdio:false,reason:'missing-option-value'};
      if(name==='--listen'){
        if(listen!==null)return {stdio:false,reason:'ambiguous-transport'};
        listen=value;
      }
      continue;
    }
    if(!server&&arg==='app-server'){server=true;continue;}
    if(server&&serverFlags.has(arg)){
      if(arg==='--stdio'){
        if(listen!==null)return {stdio:false,reason:'ambiguous-transport'};
        listen='stdio://';
      }
      continue;
    }
    return {stdio:false,reason:'unrecognized-command-or-option'};
  }
  if(!server)return {stdio:false,reason:'not-app-server'};
  return listen===null||listen==='stdio://'?{stdio:true,reason:'direct-stdio'}:{stdio:false,reason:'other-transport'};
}
export function isStdioServer(args){return classifyRuntimeCommand(args).stdio;}
