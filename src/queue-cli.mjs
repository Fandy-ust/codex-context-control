import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {defaultQueueConfig} from './core/queue-config.mjs';
import {normalizeTaskSettings} from './core/task-settings.mjs';
import {CONTROL_ROUTES} from './contracts/control-api.mjs';

export const queueHelp={
  commands:[
    'queue schema', 'queue chats | models | list', 'queue show <thread-id>',
    'queue add <thread-id> --prompt-file <file|-> [--settings-file file] [--request-id id]',
    'queue edit <thread-id> <task-id> --prompt-file <file|-> [--settings-file file]',
    'queue start | resume | pause | pause-cycle <thread-id>',
    'queue delete | retry | stop <thread-id> <task-id>',
    'queue config <thread-id> --input <file|->',
    'queue task-config <thread-id> <task-id> --input <file|->',
    'queue reorder <thread-id> --input <file|->',
    'queue command --input <file|->', 'queue pause-all', 'queue monitoring-on | monitoring-off', 'queue account-switch-on | account-switch-off'
  ],
  output:'JSON {schemaVersion:1,ok:true,data} or {schemaVersion:1,ok:false,error:{code,message}}; failures exit nonzero.',
  revisions:'Mutations read the latest revision automatically. Pass --revision N to use your own snapshot. Conflicts are not retried.',
  retries:'Reuse --request-id for an add retry. Dedupe lasts while that task is retained. No blind retries after timeouts.',
  pause:'pause prevents later tasks from starting; stop requests interruption of the specified running task.',
  input:'--input reads JSON; --prompt-file reads literal UTF-8 text. A dash reads stdin. --prompt accepts a literal argument.',
  rawActions:['add','edit','delete','reorder','config','task-config','enable','pause-cycle','retry','stop','disable-all','monitoring','account-switch']
};
const fail=(code,message)=>{throw Object.assign(Error(message),{code});};
export function createControlClient({home,ensure,fetcher=fetch}={}){
  let ready;
  return async(operation,params)=>{
    try{await (ready??=ensure());}catch{fail('SERVICE_UNAVAILABLE','Cannot start or connect to the controller. Run doctor for diagnostics.');}
    let connection;
    try{connection=JSON.parse(await fs.readFile(path.join(home,'connection.json'),'utf8'));}catch{fail('SERVICE_UNAVAILABLE','Cannot read the local controller connection.');}
    if(!Number.isInteger(connection.port)||connection.port<1||connection.port>65535||typeof connection.token!=='string'||!/^[a-f0-9]{64}$/.test(connection.token))fail('SERVICE_UNAVAILABLE','Invalid local controller connection.');
    const route=CONTROL_ROUTES[operation];if(!route)fail('INVALID_COMMAND','Unknown controller operation.');
    let response;
    try{response=await fetcher(`http://127.0.0.1:${connection.port}${route.path}`,{method:route.method,headers:{authorization:`Bearer ${connection.token}`,'content-type':'application/json'},...(params===undefined?{}:{body:JSON.stringify(params)}),signal:AbortSignal.timeout(['statistics','quota-analytics'].includes(operation)?30000:15000)});}catch{fail('TRANSPORT_UNCERTAIN','Controller request failed or timed out. A mutation may have been accepted; inspect the queue before retrying.');}
    let result;try{result=await response.json();}catch{fail('INVALID_RESPONSE','Controller returned an invalid response.');}
    if(!response.ok)fail(response.status===403?'AUTH_FAILED':operation==='task-queue'?'QUEUE_REJECTED':'REQUEST_REJECTED',typeof result.error==='string'?result.error:'Controller rejected the request.');
    return result;
  };
}

export async function runQueueCLI(args,{client,stdin=process.stdin,readFile=file=>fs.readFile(file,'utf8')}={}){
  if(!args.length||args.includes('--help')||args[0]==='help')return queueHelp;
  if(args.length===1&&args[0]==='schema')return {schemaVersion:1,defaults:{quota:defaultQueueConfig(),taskSettings:normalizeTaskSettings(null)},commandFields:{action:'One of rawActions',id:'Chat/thread id',taskId:'Required for edit, delete, retry, stop, task-config',prompt:'Literal task text for add/edit; 1–16000 characters',settings:'Task settings for add/edit',config:'Quota config for config/task-config',order:'Complete array of task ids for reorder',enabled:'Boolean for enable',expectedRevision:'Optional non-negative revision',requestId:'Optional add idempotency key, 1–128 ASCII letters/digits/._:-'},...queueHelp};
  const positional=[],flags={};
  for(let i=0;i<args.length;i++){
    const arg=args[i];if(arg==='--json')continue;
    if(arg.startsWith('--')){
      if(!['--input','--prompt','--prompt-file','--settings-file','--revision','--request-id'].includes(arg)||Object.hasOwn(flags,arg))fail('INVALID_ARGUMENT','Unknown or duplicate option: '+arg);
      if(args[i+1]===undefined||args[i+1].startsWith('--'))fail('INVALID_ARGUMENT','Missing value for '+arg);
      flags[arg]=args[++i];
    }else positional.push(arg);
  }
  let stdinText;
  async function textFile(file){
    let value;
    try{if(file==='-'){if(stdinText===undefined){stdinText='';for await(const chunk of stdin){stdinText+=chunk.toString();if(Buffer.byteLength(stdinText)>65536)fail('INPUT_TOO_LARGE','Input exceeds 64 KiB.');}}value=stdinText;}else value=await readFile(file);}
    catch(error){if(error.code==='INPUT_TOO_LARGE')throw error;fail('INPUT_ERROR','Cannot read input file: '+file);}
    if(Buffer.byteLength(value)>65536)fail('INPUT_TOO_LARGE','Input exceeds 64 KiB.');return value;
  }
  async function jsonFile(file){if(!file)fail('INVALID_ARGUMENT','--input is required.');try{return JSON.parse(await textFile(file));}catch(error){if(error.code)throw error;fail('INVALID_JSON','Input is not valid JSON.');}}
  const [action,id,taskId]=positional;
  const arity=n=>{if(positional.length!==n)fail('INVALID_ARGUMENT','Unexpected or missing positional arguments for '+action);};
  const only=allowed=>{for(const key of Object.keys(flags))if(!allowed.includes(key))fail('INVALID_ARGUMENT','Option is not supported by '+action+': '+key);};
  if(['list','chats','models','show'].includes(action)){
    arity(action==='show'?2:1);only([]);const state=await client('state');
    if(!state.capabilities?.taskQueues)fail('UNSUPPORTED_SERVICE','Update the controller to a version with task queues.');
    if(action==='chats')return state.threads.map(t=>({id:t.id,name:t.name,cwd:t.cwd,connected:t.connected,status:t.status,model:t.model,effort:t.effort??'medium'}));
    if(action==='models')return state.queueModels??[];
    if(action==='show')return {id,queue:state.taskQueues.queues.find(q=>q.id===id)??null};
    return state.taskQueues;
  }
  let command;
  if(action==='command'){
    arity(1);only(['--input','--revision']);command=await jsonFile(flags['--input']);
    if(!command||typeof command!=='object'||Array.isArray(command)||!queueHelp.rawActions.includes(command.action))fail('INVALID_ARGUMENT','Invalid queue command object.');
  }else if(['account-switch-on','account-switch-off'].includes(action)){arity(1);only([]);command={action:'account-switch',enabled:action==='account-switch-on'};}else if(['monitoring-on','monitoring-off'].includes(action)){arity(1);only([]);command={action:'monitoring',enabled:action==='monitoring-on'};}else if(action==='pause-all'){arity(1);only([]);command={action:'disable-all'};}
  else{
    command={id};
    if(['add','edit'].includes(action)){
      arity(action==='add'?2:3);only(['--prompt','--prompt-file','--settings-file','--revision',...(action==='add'?['--request-id']:[])]);
      if(Number(Object.hasOwn(flags,'--prompt'))+Number(Object.hasOwn(flags,'--prompt-file'))!==1)fail('INVALID_ARGUMENT','Specify exactly one of --prompt or --prompt-file.');
      command={...command,action,prompt:flags['--prompt-file']?await textFile(flags['--prompt-file']):flags['--prompt'],...(taskId?{taskId}:{})};
      if(flags['--settings-file'])command.settings=await jsonFile(flags['--settings-file']);
      if(action==='add')command.requestId=flags['--request-id']??randomUUID();
    }else if(['start','resume','pause','pause-cycle'].includes(action)){
      arity(2);only(['--revision']);command={...command,...(action==='pause-cycle'?{action}:{action:'enable',enabled:action!=='pause'})};
    }else if(['delete','retry','stop'].includes(action)){
      arity(3);only(['--revision']);command={...command,action,taskId};
    }else if(['config','task-config','reorder'].includes(action)){
      arity(action==='task-config'?3:2);only(['--input','--revision']);command={...command,action,...(taskId?{taskId}:{}),[action==='reorder'?'order':'config']:await jsonFile(flags['--input'])};
    }else fail('INVALID_COMMAND','Unknown queue command: '+action);
  }
  if(flags['--revision']!==undefined){const raw=flags['--revision'];if(!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw)))fail('INVALID_ARGUMENT','Revision must be a non-negative integer.');command.expectedRevision=Number(raw);}
  if(!['disable-all','monitoring','account-switch'].includes(command.action)){
    if(typeof command.id!=='string'||!command.id)fail('INVALID_ARGUMENT','A thread id is required.');
    if(command.expectedRevision==null){const state=await client('state');if(!state.capabilities?.taskQueues)fail('UNSUPPORTED_SERVICE','Update the controller to a version with task queues.');command.expectedRevision=state.taskQueues.queues.find(q=>q.id===command.id)?.revision??0;}
  }
  const result=await client('task-queue',command);
  return {...result,...(command.requestId?{requestId:command.requestId}:{})};
}

export const createQueueClient=createControlClient;
