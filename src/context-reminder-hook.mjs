// A bounded, fail-open command hook. Never starts a service or a model turn.
import fs from 'node:fs';
import path from 'node:path';

let output={};
const deadline=setTimeout(()=>{process.stdout.write('{}\n');process.exit(0);},1500);
try{
  const home=process.argv[2];
  if(!home||!path.isAbsolute(home))throw Error('Missing control home');
  const preference=JSON.parse(fs.readFileSync(path.join(home,'context-reminders.json'),'utf8'));
  // Drain stdin even while disabled so a large tool-result writer does not
  // receive a broken pipe. Retain at most 1 MiB and keep the hard deadline.
  let input='',oversized=false;
  for await(const chunk of process.stdin){
    if(preference.enabled===true&&!oversized){input+=chunk;if(Buffer.byteLength(input)>1024*1024){input='';oversized=true;}}
  }
  if(preference.enabled===true){
    process.env.CONTEXT_CONTROL_HOME=home;
    if(oversized)throw Error('Hook input too large');
    const event=JSON.parse(input);
    if(['UserPromptSubmit','PostToolUse','PostCompact'].includes(event.hook_event_name)&&typeof event.session_id==='string'){
      const {request}=await import('./ipc.mjs');
      // Do not forward prompts, tool arguments, output or transcript paths.
      output=await request('contextReminderHook',Object.fromEntries(['hook_event_name','session_id','turn_id','model','agent_id','tool_use_id'].filter(key=>typeof event[key]==='string'&&event[key].length<=256).map(key=>[key,event[key]])),700);
    }
  }
}catch{/* Disabled, unavailable, untrusted and failed hooks never block work. */}
clearTimeout(deadline);process.stdout.write(JSON.stringify(output)+'\n');
