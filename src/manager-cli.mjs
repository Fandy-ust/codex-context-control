import {bundledSkillPath,installSkill} from './skill-install.mjs';
import {tokenNumber} from './core/policy.mjs';
import {calculateBudget,savedBudget} from './core/budget.mjs';
import {budgetCommand} from './core/budget-command.mjs';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

export const managerHelp={
 commands:['global sync-status','global sync-now','global sync-configure --input <file|->','global status','global quota [--refresh]','global usage [--days 28|56|84] [--refresh]','global defaults','global defaults-set --window 400K --compact 360K [--revision N]','chat list [--offset N]','chat show <thread-id|current> [--summary]' ,'chat set|preflight <thread-id> --window 400K [--compact 360K | --compact-percent 90] [--reserve 16K] [--floor 0] [--revision N] [--save-only] [--request-id ID]','chat compact <thread-id|current> [--when-idle] [--request-id ID]', 'chat operations <thread-id|current>', 'chat operation|cancel <thread-id|current> <operation-id>','chat schedule <thread-id|current> --prompt-file <file|-> --request-id ID [--after-operation ID] [--revision N]', 'chat schedules <thread-id|current>', 'chat schedule-cancel <thread-id|current> <schedule-id>', 'chat stop-auto <thread-id>','chat speed <thread-id> [--limit 20] [--summary] [--refresh]','chat stats <thread-id> [--refresh]','skill path','skill install [--path <skills-directory>] [--force]','queue --help'],
 semantics:{scheduling:'One same-chat continuation after the exact current turn completes and context/quota checks pass. Register before ending the turn; never poll yourself waiting to become idle. Pauses and new user input cancel waiting intent.',window:'User-visible target tokens, not raw runtime tokens. The app owns conversion, validation, application and compensation.',defaults:'Affects newly created user chats; existing chats retain their budgets and forks inherit their parent.',speed:'Read-only observed generation throughput; no model/tier/speed switching or fixed tokens/s control.',application:'Saved/queued is not confirmed. Inspect the returned operation receipt; budget readback requires a normal subsequent request.',current:'current resolves CODEX_THREAD_ID and verifies the target; it never guesses the foreground chat.',operations:'Reuse --request-id when retrying set/compact. Receipts are retained up to 200 entries. Deferred compaction expires after 15 minutes, cancels on relevant state changes or disconnect, and never starts a new message.'}
};
const fail=(code,message)=>{throw Object.assign(Error(message),{code});};
export {speedReport} from './core/speed-report.mjs';
export async function runManagerCLI(args,{client,stdin=process.stdin,readFile=file=>fs.readFile(file,'utf8'),env=process.env}={}){
 if(!args.length||args.includes('--help'))return managerHelp;
 const positional=[],flags={};
 for(let i=0;i<args.length;i++){const arg=args[i];if(arg==='--json')continue;if(arg.startsWith('--')){if(Object.hasOwn(flags,arg))fail('INVALID_ARGUMENT','Duplicate option: '+arg);if(['--refresh','--save-only','--force','--summary','--when-idle'].includes(arg)){flags[arg]=true;continue;}if(!['--window','--compact','--compact-percent','--reserve','--floor','--revision','--limit','--offset','--days','--path','--input','--request-id','--prompt-file','--after-operation'].includes(arg)||args[i+1]===undefined||args[i+1].startsWith('--'))fail('INVALID_ARGUMENT','Unknown option or missing value: '+arg);flags[arg]=args[++i];}else positional.push(arg);}
 const [scope,action,target,operationId]=positional;
 const id=scope==='chat'&&target==='current'?env.CODEX_THREAD_ID:target;
 if(scope==='chat'&&target==='current'&&(!id||! /^[a-f\d-]{36}$/i.test(id)))fail('CURRENT_CHAT_UNKNOWN','No valid CODEX_THREAD_ID; choose a chat explicitly.');
 const check=(count,allowed=[])=>{if(positional.length!==count)fail('INVALID_ARGUMENT','Unexpected or missing arguments.');for(const key of Object.keys(flags))if(!allowed.includes(key))fail('INVALID_ARGUMENT','Unsupported option: '+key);};
 const revision=fallback=>{if(flags['--revision']===undefined)return fallback;const raw=flags['--revision'];if(!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw)))fail('INVALID_ARGUMENT','Revision must be a non-negative integer.');return Number(raw);};
 if(scope==='skill'&&action==='path'){check(2);return {path:bundledSkillPath,name:'context-manager'};}
 if(scope==='skill'&&action==='install'){check(2,['--path','--force']);return installSkill({skillsRoot:flags['--path'],force:!!flags['--force']});}
 if(scope==='global'){
  if(action==='sync-status'||action==='sync-now'){check(2);return client('cloud-sync',{action:action==='sync-status'?'status':'sync'});}
  if(action==='sync-configure'){
    check(2,['--input']);if(!flags['--input'])fail('INVALID_ARGUMENT','--input <file|-> is required.');
    let raw='';if(flags['--input']==='-'){for await(const chunk of stdin){raw+=chunk;if(Buffer.byteLength(raw)>16384)fail('INVALID_ARGUMENT','Sync configuration too large.');}}else raw=await readFile(flags['--input']);
    if(Buffer.byteLength(raw)>16384)fail('INVALID_ARGUMENT','Sync configuration too large.');
    let config;try{config=JSON.parse(raw);}catch{fail('INVALID_ARGUMENT','Invalid sync configuration JSON.');}
    if(!config||typeof config!=='object'||Array.isArray(config))fail('INVALID_ARGUMENT','Expected sync configuration object.');
    return client('cloud-sync',{...config,action:'configure'});
  }
  if(action==='status'){check(2);const s=await client('state');return {version:s.version,bridgeCount:s.bridgeCount,chatCount:s.threads.length,capabilities:s.capabilities,contextExtension:s.contextExtension,compactionCompensation:s.compactionCompensation,newChatDefaults:s.newChatDefaults,newChatDefaultsLimits:s.newChatDefaultsLimits,queues:{count:s.taskQueues?.queues.length??0,enabled:s.taskQueues?.queues.filter(q=>q.enabled).length??0,scheduled:s.taskQueues?.schedules?.filter(v=>['waiting_for_turn','waiting_context','waiting_quota','dispatching','running'].includes(v.state)).length??0}};}
  if(action==='quota'){check(2,['--refresh']);return flags['--refresh']?client('quota-refresh',{}):(await client('state')).quota;}
  if(action==='usage'){check(2,['--days','--refresh']);const days=flags['--days']===undefined?28:Number(flags['--days']);if(![28,56,84].includes(days))fail('INVALID_ARGUMENT','Days must be 28, 56 or 84.');return client('quota-analytics',{days,refresh:!!flags['--refresh']});}
  if(action==='defaults'){check(2);const s=await client('state');return {defaults:s.newChatDefaults,limits:s.newChatDefaultsLimits};}
  if(action==='defaults-set'){check(2,['--window','--compact','--revision']);if(!flags['--window']||!flags['--compact'])fail('INVALID_ARGUMENT','--window and --compact are required.');const s=await client('state');return client('defaults',{usableWindow:tokenNumber(flags['--window']),compact:tokenNumber(flags['--compact']),expectedRevision:revision(s.newChatDefaults?.revision??0)});}
 }
 if(scope==='chat'){
  if(action==='list'){check(2,['--offset']);const offset=Number(flags['--offset']??0);if(!Number.isSafeInteger(offset)||offset<0||offset>100000)fail('INVALID_ARGUMENT','Offset must be a nonnegative integer.');return (await client('chat-list',{offset})).chats;}
  if(action==='show'){check(3,['--summary']);return client('chat',{id,summary:!!flags['--summary']});}
  if(['operations','operation','cancel'].includes(action)){check(action==='operations'?3:4);return client('context-operation',{id,action:action==='operations'?'list':action==='operation'?'show':'cancel',...(operationId?{operationId}:{})});}
  if(action==='speed'||action==='stats'){check(3,action==='speed'?['--limit','--refresh','--summary']:['--refresh']);const limit=flags['--limit']===undefined?20:Number(flags['--limit']);if(!Number.isInteger(limit)||limit<1||limit>200)fail('INVALID_ARGUMENT','Limit must be an integer from 1 to 200.');return action==='speed'?client('speed-report',{id,limit,summary:!!flags['--summary'],refresh:!!flags['--refresh']}):client('statistics',{id,refresh:!!flags['--refresh']});}
  if(['schedules','schedule-cancel'].includes(action)){check(action==='schedules'?3:4);return client('context-schedule',{id,action:action==='schedules'?'list':'cancel',...(operationId?{scheduleId:operationId}:{})});}
  if(action==='schedule'){
   check(3,['--prompt-file','--request-id','--after-operation','--revision']);if(!flags['--prompt-file']||!flags['--request-id'])fail('INVALID_ARGUMENT','--prompt-file and a stable --request-id are required.');
   let prompt='';if(flags['--prompt-file']==='-'){for await(const chunk of stdin){prompt+=chunk;if(Buffer.byteLength(prompt)>65536)fail('INVALID_ARGUMENT','Checkpoint exceeds 64 KiB.');}}else prompt=await readFile(flags['--prompt-file']);
   if(typeof prompt!=='string'||prompt.length>16000)fail('INVALID_ARGUMENT','Checkpoint must contain at most 16000 characters.');
   return client('context-schedule',{id,action:'schedule',prompt,requestId:flags['--request-id'],...(flags['--after-operation']?{afterOperation:flags['--after-operation']}:{}),...(flags['--revision']!==undefined?{expectedRevision:revision()}:{} )});
  }
  if(action==='compact'){check(3,['--when-idle','--request-id']);return client('compact',{id,track:true,whenIdle:!!flags['--when-idle'],requestId:flags['--request-id']??randomUUID()});}
  if(action==='stop-auto'){check(3);return client('clear',{id});}
  if(action==='set'||action==='preflight'){
   check(3,['--window','--compact','--compact-percent','--reserve','--floor','--revision',...(action==='set'?['--save-only','--request-id']:[])]);
   if(!flags['--window'])fail('INVALID_ARGUMENT','--window is required.');if(flags['--compact']&&flags['--compact-percent'])fail('INVALID_ARGUMENT','Choose --compact or --compact-percent.');
   const t=await client('chat',{id}),s={capabilities:{visibleBudget:true}};if(!t?.id)fail('CHAT_NOT_FOUND','Chat not found.');
   const usableWindow=tokenNumber(flags['--window']),previous=savedBudget(t.policy,t.modelMetadata);
   const budget=calculateBudget({usableWindow,compactPercent:flags['--compact']?1:(flags['--compact-percent']??previous?.compactPercent??90)},t.modelMetadata);
   const policy={window:budget.window,compact:flags['--compact']?tokenNumber(flags['--compact']):budget.compact,reserve:flags['--reserve']?tokenNumber(flags['--reserve']):(t.policy?.reserve??16000),retainedFloor:flags['--floor']?tokenNumber(flags['--floor']):(t.policy?.retainedFloor??0),scope:'total'};
   return client(action==='set'?'policy':'preflight',{id,...budgetCommand({window:usableWindow},policy,s.capabilities),...(action==='set'?{expectedRevision:revision(t.policy?.revision??0),apply:!flags['--save-only'],track:true,requestId:flags['--request-id']??randomUUID()}:{})});
  }
 }
 fail('INVALID_COMMAND','Unknown manager command. Use --help.');
}
