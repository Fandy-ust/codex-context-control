#!/usr/bin/env node
import {queueCLIPath} from './cli-launcher.mjs';
import {version as productVersion} from './version.mjs';
import fs from 'node:fs';
import {L} from './localization.mjs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {request} from './ipc.mjs';
import {root,realBinary,readJSON} from './paths.mjs';
import {ensureDaemon} from './service.mjs';
import {runtimeSupported} from './compatibility.mjs';
import {automaticStartupStatus} from './automatic-startup.mjs';
import {calculateBudget} from './budget.mjs';
import {menuBarStatus} from './menu-bar.mjs';

const [command='doctor',...args]=process.argv.slice(2);
try{
  if(['global','chat','skill'].includes(command)){
    const {runManagerCLI}=await import('./manager-cli.mjs');const {createControlClient}=await import('./queue-cli.mjs');const data=await runManagerCLI([command,...args],{client:createControlClient({home:root,ensure:ensureDaemon})});process.stdout.write(JSON.stringify({schemaVersion:1,ok:true,data})+'\n');
  }else if(command==='queue'){
    const {runQueueCLI,createControlClient}=await import('./queue-cli.mjs');const data=await runQueueCLI(args,{client:createControlClient({home:root,ensure:ensureDaemon})});process.stdout.write(JSON.stringify({schemaVersion:1,ok:true,data})+'\n');
  }else if(command==='--version'||command==='version'){process.stdout.write(productVersion+'\n');
  }else if(command==='--help'||command==='help'){const {managerHelp}=await import('./manager-cli.mjs');process.stdout.write(JSON.stringify({schemaVersion:1,ok:true,data:managerHelp})+'\n');
  }else if(command==='hook'){
    let text='';for await(const chunk of process.stdin){text+=chunk;if(text.length>65536)throw new Error('input limit');}
    const event=JSON.parse(text);if(event.hook_event_name!=='Stop'){process.stdout.write('{}\n');}
    else {let answer={};try{answer=await request('hook',{sessionId:event.session_id,turnId:event.turn_id},500);}catch{}process.stdout.write(JSON.stringify(answer)+'\n');}
  }else if(command==='start'){
    await ensureDaemon();process.stdout.write(L('本地控制服务已启动。\n'));
  }else if(command==='list'){
    process.stdout.write(JSON.stringify(await request('state'),null,2)+'\n');
  }else if(command==='set-usable'){
    const [id,usableWindow,compactPercent='90']=args;if(!id||!usableWindow)throw new Error('用法：set-usable <聊天ID> <700K> [90]');
    const thread=(await request('state')).threads.find(t=>t.id===id);if(!thread)throw new Error('未找到聊天');
    const budget=calculateBudget({usableWindow,compactPercent},thread.modelMetadata);
    const policy={window:budget.window,compact:budget.compact,reserve:thread.policy?.reserve??16000,retainedFloor:thread.policy?.retainedFloor??0};
    const answer=await request('setPolicy',{id,policy,apply:true});process.stdout.write(JSON.stringify({budget,...answer},null,2)+'\n');
  }else if(command==='set'){
    const [id,window,compact]=args;if(!id||!window)throw new Error('用法：set <聊天ID> <400K> [320K]');
    const answer=await request('setPolicy',{id,policy:{window,compact},apply:true});process.stdout.write(JSON.stringify(answer,null,2)+'\n');
  }else if(command==='doctor'){
    let service=false;try{service=(await request('ping',{},500)).ok;}catch{}
    let version='unavailable';try{version=spawnSync(realBinary(),['--version'],{windowsHide:true,encoding:'utf8'}).stdout.trim();}catch{}
    const state=service?await request('state'):{bridgeCount:0,threads:[]};
    const settings=readJSON(path.join(root,'settings.json'),{});
    console.log(JSON.stringify({version:productVersion,node:process.version,runtime:version,runtimeSupported:runtimeSupported(version),service,connectedBridges:state.bridgeCount,serviceVersion:state.version??null,loadedBridgeVersions:(state.bridges||[]).map(b=>b.version),automaticStartup:['darwin','win32'].includes(process.platform)?automaticStartupStatus():null,
      runtimeFix:state.runtimeFix??null,contextExtension:state.contextExtension??null,newChatDefaults:state.newChatDefaults??null,newChatDefaultsPending:state.newChatDefaultsPending??null,observedChats:state.threads.length,installRoot:root,queueCLI:queueCLIPath(root),hookInstalled:!!settings.hookCommand,menuBar:menuBarStatus(),
      activation:state.bridgeCount?'connected':L('照常打开 Codex；首次安装或更新后请正常重开一次客户端。')},null,2));
  }else throw new Error('支持 doctor、start、list、set-usable、set（底层配置）、queue、hook');
}catch(error){if(['queue','global','chat','skill'].includes(command)){process.stderr.write(JSON.stringify({schemaVersion:1,ok:false,error:{code:error.code||'CLI_ERROR',message:error.message}})+'\n');process.exitCode=1;}else if(command==='hook'){process.stdout.write('{}\n');}else{process.stderr.write(L(error.message)+'\n');process.exitCode=1;}}
