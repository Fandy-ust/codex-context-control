#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {request} from './ipc.mjs';
import {root,realBinary,readJSON} from './paths.mjs';
import {ensureDaemon} from './service.mjs';
import {runtimeSupported,verifiedVersions} from './compatibility.mjs';

const [command='doctor',...args]=process.argv.slice(2);
try{
  if(command==='hook'){
    let text='';for await(const chunk of process.stdin){text+=chunk;if(text.length>65536)throw new Error('input limit');}
    const event=JSON.parse(text);if(event.hook_event_name!=='Stop'){process.stdout.write('{}\n');}
    else {let answer={};try{answer=await request('hook',{sessionId:event.session_id,turnId:event.turn_id},500);}catch{}process.stdout.write(JSON.stringify(answer)+'\n');}
  }else if(command==='start'){
    await ensureDaemon();process.stdout.write('本地控制服务已启动。\n');
  }else if(command==='list'){
    process.stdout.write(JSON.stringify(await request('state'),null,2)+'\n');
  }else if(command==='set'){
    const [id,window,compact]=args;if(!id||!window)throw new Error('用法：set <聊天ID> <400K> [320K]');
    const answer=await request('setPolicy',{id,policy:{window,compact},apply:true});process.stdout.write(JSON.stringify(answer,null,2)+'\n');
  }else if(command==='doctor'){
    let service=false;try{service=(await request('ping',{},500)).ok;}catch{}
    let version='unavailable';try{version=spawnSync(realBinary(),['--version'],{encoding:'utf8'}).stdout.trim();}catch{}
    const state=service?await request('state'):{bridgeCount:0,threads:[]};
    const settings=readJSON(path.join(root,'settings.json'),{});
    console.log(JSON.stringify({version:'0.1.0',node:process.version,runtime:version,runtimeSupported:runtimeSupported(version),verifiedVersions,service,connectedBridges:state.bridgeCount,
      observedChats:state.threads.length,installRoot:root,hookInstalled:!!settings.hookCommand,
      activation:state.bridgeCount?'connected':'退出当前 Codex 后，通过 Codex Context Launcher 启动以接入。'},null,2));
  }else throw new Error('支持 doctor、start、list、set、hook');
}catch(error){if(command==='hook'){process.stdout.write('{}\n');}else{process.stderr.write(error.message+'\n');process.exitCode=1;}}
