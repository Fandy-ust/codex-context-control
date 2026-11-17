import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createContextReminders,contextReminderCommand,CONTEXT_REMINDER_EVENTS} from '../src/context-reminders.mjs';
import {DEFAULT_REMINDER_CONFIG,normalizeReminderConfig,renderReminderConfig} from '../src/core/context-reminder-config.mjs';
import {contextReminderSettings} from '../desktop/renderer/context-reminder-settings.mjs';

function fixture(run){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'cm-reminders-')),home=path.join(temp,'control'),codex=path.join(temp,'codex');fs.mkdirSync(home);fs.mkdirSync(codex);
  let time=1000000,command='CONTEXT_REMINDER_V1';
  const managers=[];
  const create=()=>{const manager=createContextReminders({home,codex,command:()=>command,now:()=>time});managers.push(manager);return manager;};
  try{return run({home,codex,create,advance:ms=>time+=ms,clock:()=>time,upgrade:()=>command='CONTEXT_REMINDER_V2'});}finally{for(const manager of managers)manager.flushLog();fs.rmSync(temp,{recursive:true,force:true});}
}
const thread=now=>({id:'chat',model:'fixture',turnId:'turn',connected:true,status:'active',phase:'confirmed',revision:1,usageFresh:true,usageObservedAt:now,observedAt:now,lastUsage:{totalTokens:100000},expectedWindow:400000,observedWindow:400000,appliedBudget:{compact:350000,reserve:16000},policy:{window:421053,compact:350000,reserve:16000,scope:'total',revision:1,enabled:true},modelMetadata:{effective_context_window_percent:95,max_context_window:1000000}});
const event=(kind='PostToolUse',extra={})=>({hook_event_name:kind,session_id:'chat',turn_id:'turn',model:'fixture',...extra});
const text=output=>output.hookSpecificOutput?.additionalContext??'';

test('default off touches no hook configuration; opt-in, upgrade and disable preserve external handlers',()=>fixture(({home,codex,create,upgrade})=>{
  const file=path.join(codex,'hooks.json'),manager=create();
  assert.equal(manager.status().enabled,false);assert.deepEqual(manager.hook(event(),thread(1)),{});manager.reconcile();manager.setEnabled(false);assert.equal(fs.existsSync(file),false);
  const external={hooks:{Stop:[{hooks:[{type:'command',command:'EXTERNAL_STOP'}]}],PostToolUse:[{matcher:'Bash',hooks:[{type:'command',command:'EXTERNAL_TOOL'}]}]},custom:'keep'};
  fs.writeFileSync(file,JSON.stringify(external));manager.setEnabled(true);
  let hooks=JSON.parse(fs.readFileSync(file));for(const kind of CONTEXT_REMINDER_EVENTS)assert.equal(hooks.hooks[kind].flatMap(g=>g.hooks).filter(h=>h.command==='CONTEXT_REMINDER_V1').length,1);
  assert.deepEqual(hooks.hooks.Stop,external.hooks.Stop);manager.setEnabled(true);assert.deepEqual(JSON.parse(fs.readFileSync(file)),hooks);
  upgrade();create().reconcile();hooks=JSON.parse(fs.readFileSync(file));assert.ok(!JSON.stringify(hooks).includes('CONTEXT_REMINDER_V1'));
  manager.setEnabled(false);hooks=JSON.parse(fs.readFileSync(file));assert.deepEqual(hooks.hooks.PostToolUse,external.hooks.PostToolUse);assert.deepEqual(hooks.hooks.Stop,external.hooks.Stop);assert.equal(hooks.custom,'keep');assert.ok(!JSON.stringify(hooks).includes('CONTEXT_REMINDER_'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(home,'context-reminders.json'))).enabled,false);
}));

test('invalid hook configuration cannot partially opt in or overwrite unrelated configuration',()=>fixture(({home,codex,create})=>{
  const file=path.join(codex,'hooks.json'),original='{"hooks":{"PostCompact":42}}';fs.writeFileSync(file,original);
  assert.throws(()=>create().setEnabled(true),/PostCompact/);assert.equal(fs.readFileSync(file,'utf8'),original);assert.equal(fs.existsSync(path.join(home,'context-reminders.json')),false);
  assert.throws(()=>create().setEnabled('true'),/开关值/);
}));

test('chat opt-ins persist across restarts and global pause without affecting new chats',()=>fixture(({create,clock})=>{
  const manager=create();manager.setEnabled(true);
  assert.deepEqual(manager.status().enabledChatIds,[]);
  assert.deepEqual(manager.hook(event(),thread(clock())),{});
  manager.setChatEnabled('chat',true);
  assert.deepEqual(create().status().enabledChatIds,['chat']);
  const restarted=create();assert.ok(text(restarted.hook(event(),thread(clock()))));
  restarted.flushLog();
  assert.equal(create().log('chat')[0].trigger,'first','only actual reminders are preserved across service restarts');
  assert.deepEqual(create().log('fork'),[]);
  manager.setEnabled(false);
  assert.deepEqual(create().hook(event(),thread(clock())),{});
  manager.setEnabled(true);
  assert.ok(text(manager.hook(event(),thread(clock()))));
  assert.deepEqual(manager.hook(event('PostToolUse',{session_id:'fork'}),{...thread(clock()),id:'fork'}),{});
}));

test('opt-out persists immediately even when external edits prevent hook removal',()=>fixture(({home,codex,create,clock})=>{
  const manager=create();manager.setEnabled(true);fs.writeFileSync(path.join(codex,'hooks.json'),'invalid');
  const disabled=manager.setEnabled(false);assert.equal(disabled.enabled,false);assert.ok(disabled.error);assert.deepEqual(manager.hook(event(),thread(clock())),{});
  assert.equal(JSON.parse(fs.readFileSync(path.join(home,'context-reminders.json'))).enabled,false);
}));

test('short informational reminders distinguish loaded budgets and targets; parallel tool completions are coalesced',()=>fixture(({create,clock,advance})=>{
  const manager=create();manager.setEnabled(true);manager.setChatEnabled("chat",true);const t=thread(clock());
  const output=manager.hook(event('UserPromptSubmit'),t);assert.deepEqual(Object.keys(output),['hookSpecificOutput']);assert.match(text(output),/400,000/);assert.match(text(output),/350,000/);assert.match(text(output),/234,000/);assert.match(text(output),/chat show current --summary/);assert.ok(text(output).length<3000);
  assert.match(text(output),/Keep the loaded budget unchanged by default/);assert.match(text(output),/at most 100K per adjustment/);assert.match(text(output),/Consider early compaction at a natural checkpoint/);assert.match(text(output),/If the remaining work fits, finish and deliver/);assert.doesNotMatch(text(output),/[\u3400-\u9fff]/);
  for(let n=0;n<8;n++)assert.deepEqual(manager.hook(event('PostToolUse',{tool_use_id:'tool-'+n}),t),{});
  advance(31000);const update=text(manager.hook(event('PostToolUse',{tool_use_id:'next'}),t));assert.match(update,/Context Manager status/);assert.doesNotMatch(update,/Context Planner|chat show|450K/);
  assert.deepEqual(manager.hook(event('PostToolUse',{tool_use_id:'next'}),t),{});
  assert.equal(manager.status().reminderCount,2);
  advance(6000);t.lastUsage.totalTokens=330000;t.usageObservedAt=clock();const pressure=text(manager.hook(event(),t));assert.match(pressure,/pressure: critical/);assert.match(pressure,/4,000/);
  advance(6000);t.policy={...t.policy,window:600000,compact:540000,revision:2};t.phase='queued';const queued=text(manager.hook(event('UserPromptSubmit'),t));assert.match(queued,/Saved target:.*status: not confirmed/);assert.match(queued,/Loaded usable window: 400,000/);
}));

test('stale observations, compaction, unknown thresholds and different agents never fabricate usable headroom',()=>fixture(({create,clock,advance})=>{
  const manager=create();manager.setEnabled(true);manager.setChatEnabled("chat",true);let t=thread(clock());
  for(const change of [{id:'other'},{connected:false},{ambiguous:true},{ephemeral:true},{model:'other'},{turnId:'other'}])assert.deepEqual(manager.hook(event(),{...t,...change}),{});
  assert.deepEqual(manager.hook(event('PostToolUse',{agent_id:'child'}),t),{});assert.deepEqual(manager.hook(event('Stop'),t),{});
  advance(121000);assert.match(text(manager.hook(event(),t)),/room after reserve: unknown/);
  t=thread(clock());const compacted=text(manager.hook(event('PostCompact'),t));assert.match(compacted,/invalidated by compaction/);assert.match(compacted,/room after reserve: unknown/);
  advance(6000);assert.match(text(manager.hook(event('UserPromptSubmit'),t)),/stale or unavailable/);
  advance(1000);t.usageObservedAt=clock();t.lastUsage.totalTokens=50000;assert.match(text(manager.hook(event('UserPromptSubmit'),t)),/284,000/);
  t.appliedBudget=null;t.expectedWindow=null;t.observedWindow=null;assert.match(text(manager.hook(event('UserPromptSubmit'),t)),/room after reserve: unknown/);
  manager.setEnabled(false);assert.deepEqual(manager.hook(event(),t),{});
}));

test('hook launcher exits successfully with empty JSON when disabled, unavailable, malformed or oversized',()=>fixture(({home})=>{
  const script=fileURLToPath(new URL('../src/context-reminder-hook.mjs',import.meta.url));
  for(const enabled of [false,true]){
    fs.writeFileSync(path.join(home,'context-reminders.json'),JSON.stringify({enabled}));
    for(const input of [JSON.stringify(event()),'invalid',JSON.stringify({hook_event_name:'Stop'}),'x'.repeat(1024*1024+1)]){
      const result=spawnSync(process.execPath,[script,home],{input,encoding:'utf8',timeout:3000,windowsHide:true});assert.ifError(result.error);assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),{});
    }
  }
}));

test('hook commands quote paths literally and explicitly invoke PowerShell on Windows',()=>{
  assert.equal(contextReminderCommand({home:'/tmp/a b',node:'/node',codeRoot:'/code',platform:'darwin'}),"'/node' '/code/src/context-reminder-hook.mjs' '/tmp/a b'".replaceAll('/code/src/',path.join('/code','src')+path.sep));
  const win=contextReminderCommand({home:"C:/space %! $ user's",node:'node',codeRoot:'code',platform:'win32'});
  assert.ok(win.startsWith("& 'node' "));
  assert.ok(win.endsWith("'C:/space %! $ user''s'"));
  assert.throws(()=>contextReminderCommand({home:'bad\npath',node:'node',codeRoot:'code',platform:'win32'}),/Invalid/);
});

test('experiment parameters persist without installing hooks; preview and revisions never mutate or enable the experiment',()=>fixture(({home,codex,create,clock})=>{
  const manager=create(),initial=manager.status();assert.equal(initial.config.frequency.toolCalls,6);
  const config=normalizeReminderConfig({prompt:'Finish the task in {chat_id}.',template:'{"tokens":{context_tokens_raw},"room":{headroom_tokens_raw}}',frequency:{minIntervalSeconds:0,intervalSeconds:0,toolCalls:1,growthTokens:0,maxIntervalSeconds:5}});
  const preview=manager.preview(config,thread(clock()));assert.ok(preview.text.startsWith('{"tokens":100000,"room":234000}'));assert.match(preview.text,/Finish the task in chat/);
  assert.equal(fs.existsSync(path.join(home,'context-reminders.json')),false);assert.equal(fs.existsSync(path.join(codex,'hooks.json')),false);
  const saved=manager.configure(config,0);assert.equal(saved.enabled,false);assert.equal(saved.revision,1);assert.deepEqual(create().status().config,config);assert.equal(fs.existsSync(path.join(codex,'hooks.json')),false);
  assert.throws(()=>manager.configure(DEFAULT_REMINDER_CONFIG,0),/changed/);assert.deepEqual(manager.status().config,config);
  manager.setEnabled(true);manager.setChatEnabled('chat',true);const before=fs.readFileSync(path.join(codex,'hooks.json'),'utf8');
  assert.ok(text(manager.hook(event('PostToolUse',{tool_use_id:'1'}),thread(clock()))));assert.ok(text(manager.hook(event('PostToolUse',{tool_use_id:'2'}),thread(clock()))));
  manager.configure({...config,prompt:'New experiment prompt.'},1);assert.doesNotMatch(text(manager.hook(event('PostToolUse',{tool_use_id:'3'}),thread(clock()))),/New experiment prompt/);
  assert.match(text(manager.hook(event('PostCompact'),thread(clock()))),/New experiment prompt/);
  assert.equal(fs.readFileSync(path.join(codex,'hooks.json'),'utf8'),before,'editing parameters must not rewrite hook definitions or trust');
  manager.setEnabled(false);assert.equal(manager.status().config.prompt,'New experiment prompt.');
  manager.configure(manager.defaults().config,2);assert.deepEqual(manager.status().config,DEFAULT_REMINDER_CONFIG);
}));

test('configuration rejects typos and invalid frequency relationships; templates only substitute text',()=>{
  for(const config of [{prompt:''},{template:'{unsupported_field}'},{prompt:'x'.repeat(12001)},{frequency:{toolCalls:0}},{frequency:{growthTokens:-1}},{frequency:{intervalSeconds:1,minIntervalSeconds:5}},{frequency:{intervalSeconds:300,maxIntervalSeconds:100}},{frequency:{constructor:1}},{unknown:true}])assert.throws(()=>normalizeReminderConfig(config));
  assert.equal(renderReminderConfig(normalizeReminderConfig({prompt:'Keep working.',template:'{cli_path}'}),{cli_path:'$(not executed) {chat_id}'}),'$(not executed) {chat_id}\n\nKeep working.');
});

test('experiment UI escapes editable prompts and templates and exposes preview, defaults and frequency controls while off',()=>{
  const e=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  const config=normalizeReminderConfig({prompt:'</textarea><script>alert(1)</script>',template:'{context_tokens}'}),html=contextReminderSettings({enabled:false},config,{e,t:s=>s,expanded:true,dirty:true,preview:'<script>preview</script>'});
  assert.ok(!html.includes('<script>'));assert.match(html,/&lt;\/textarea&gt;/);assert.equal((html.match(/data-reminder-frequency=/g)||[]).length,5);for(const action of ['reminder-preview','reminder-defaults','reminder-save','reminder-reload'])assert.ok(html.includes('data-action="'+action+'"'));
  assert.match(html,/id="context-reminders" class="switch"  /);assert.match(html,/尚未保存/);
});

test('editing, toggling or restarting reminders cannot revive pre-compaction usage',()=>fixture(({create,clock,advance})=>{
  const manager=create();manager.setEnabled(true);manager.setChatEnabled("chat",true);const t=thread(clock());manager.hook(event('PostCompact'),t);
  manager.configure(manager.status().config,0);advance(1);assert.match(text(manager.hook(event(),t)),/room after reserve: unknown/);
  t.usageInvalidatedAt=clock();manager.setEnabled(false);manager.setEnabled(true);assert.match(text(manager.hook(event(),t)),/room after reserve: unknown/);
  assert.match(text(create().hook(event(),t)),/room after reserve: unknown/);
  advance(1);t.usageObservedAt=clock();assert.match(text(manager.hook(event('UserPromptSubmit'),t)),/234,000/);
}));
