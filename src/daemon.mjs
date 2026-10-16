import net from 'node:net';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {Peer,request} from './ipc.mjs';
import {root,socketPath,ensureRoot,atomicJSON} from './paths.mjs';
import {Store} from './store.mjs';
import {normalizePolicy,preflight} from './policy.mjs';
import {savedBudget} from './budget.mjs';
import {ensureMenuBarEntry} from './menu-bar.mjs';
import {reconcileWindowConfirmation} from './confirmation.mjs';
import {inheritedForkPolicy} from './fork-budget.mjs';
import {transitionExtensionBudgets} from './extension-transition.mjs';
import {createContextExtensionManager} from './context-extension.mjs';
import {createRuntimeFixManager} from './runtime-fix.mjs';
import {ceilingModel,policyForModel,CONTEXT_CEILING_VERSION} from './context-ceiling.mjs';
import {initialNewChatDefaults,nativeNewChatDefaults,newChatDefaultLimits,clampNewChatDefaults,normalizeNewChatDefaults,policyForNewChat,persistedNewChatPolicy} from './new-chat-defaults.mjs';
import {createContextStatisticsService} from './context-statistics-service.mjs';

export async function startDaemon() {
  ensureRoot();
  try {await request('ping');return null;}catch{}
  const lockFile=path.join(root,'service.lock');
  try {fs.writeFileSync(lockFile,JSON.stringify({pid:process.pid}),{flag:'wx',mode:0o600});}
  catch(error){
    if(error.code!=='EEXIST')throw error;
    let live=true;
    try {const owner=JSON.parse(fs.readFileSync(lockFile,'utf8'));try{process.kill(owner.pid,0);}catch(e){if(e.code==='ESRCH')live=false;}}
    catch{live=Date.now()-fs.statSync(lockFile).mtimeMs<5000;}
    if(live)return null;
    fs.unlinkSync(lockFile);fs.writeFileSync(lockFile,JSON.stringify({pid:process.pid}),{flag:'wx',mode:0o600});
  }
  process.once('exit',()=>{try{if(JSON.parse(fs.readFileSync(lockFile,'utf8')).pid===process.pid)fs.unlinkSync(lockFile);}catch{}});
  try {fs.unlinkSync(socketPath);}catch(error){if(error.code!=='ENOENT')throw error;}
  const store=new Store();await store.seedRecentMetadata();
  for(const t of Object.values(store.data.threads)){t.freshUsage=false;t.usageFresh=false;t.phase='disconnected';}
  store.save();
  const bridges=new Map();const owners=new Map();
  const contextStatistics=createContextStatisticsService();
  const runtimeFix=createRuntimeFixManager();
  const extension=createContextExtensionManager();
  function rebuildOwners(){owners.clear();for(const [peer,b]of bridges)for(const id of b.ids){if(!owners.has(id))owners.set(id,[]);owners.get(id).push(peer);}}
  function nativeDefaultModel(){store.model(null);return [...(store.catalog?.values()||[])].filter(m=>Number.isSafeInteger(m.max_context_window)&&Number.isInteger(m.effective_context_window_percent)).sort((a,b)=>b.max_context_window*b.effective_context_window_percent-a.max_context_window*a.effective_context_window_percent)[0]||null;}
  function defaultModel(){const m=nativeDefaultModel();return extension.enabled()?ceilingModel(m):m;}
  function modelFor(id,slug){const m=store.model(slug??store.data.threads[id]?.model);return extension.enabled()?ceilingModel(m):m;}
  function bridgeReady(b){return !!b&&(extension.enabled()?b.contextCeiling===CONTEXT_CEILING_VERSION&&b.contextCatalogRevision===2:b.contextCeiling!==CONTEXT_CEILING_VERSION);}
  function runtimeModel(id,slug,extended){const m=store.model(slug??store.data.threads[id]?.model)||nativeDefaultModel();if(typeof extended!=='boolean'){const peers=owners.get(id)||[];extended=peers.length===1?bridges.get(peers[0])?.contextCeiling===CONTEXT_CEILING_VERSION:extension.enabled();}return extended?ceilingModel(m):m;}
  function extensionState(fix=runtimeFix.status()){return extension.status([...bridges.values()],{compatible:fix.originalVersion==='0.160.0',available:!!nativeDefaultModel()});}
  function publicThread(id,extensionStatus){const t=store.publicThread(id,owners),m=modelFor(id,t.model),peers=owners.get(id)||[];const ready=peers.length===1&&bridgeReady(bridges.get(peers[0]));return {...t,policy:policyForModel(t.policy,m,{revise:false}),...(!ready&&peers.length?{phase:'extension_pending',message:(extensionStatus??extensionState()).message}:{}),modelMetadata:m?Object.fromEntries(['max_context_window','context_window','effective_context_window_percent','context_ceiling','context_compact_ceiling'].map(k=>[k,m[k]]).concat([['context_catalog_ready',ready]])):null};}
  function newChatDefaults(){return clampNewChatDefaults(store.data.newChatDefaults||(extension.enabled()?initialNewChatDefaults:nativeNewChatDefaults),defaultModel());}
  function state(){const fix=runtimeFix.status(undefined,[...bridges.values()]),ext=extensionState(fix);return {newChatDefaults:newChatDefaults(),newChatDefaultsLimits:newChatDefaultLimits(defaultModel()),newChatDefaultsPending:[...bridges.values()].some(b=>!b.newChatDefaultsVersion),version:'0.14.1',bridgeCount:bridges.size,contextExtension:ext,contextCeilingPending:ext.pending,runtimeFix:fix,bridges:[...bridges.values()].map(b=>({pid:b.pid,version:b.version??null,runtimeFixId:b.runtimeFixId??null})),threads:Object.keys(store.data.threads).map(id=>publicThread(id,ext)).filter(t=>!t.archived&&t.ephemeral!==true).sort((a,b)=>(b.observedAt||0)-(a.observedAt||0))};}
  async function handle(peer,op,p) {
    if(op==='ping')return {ok:true,version:'0.14.1'};
    if(op==='state')return state();
    if(op==='newChatBudget'){const m=runtimeModel(null,p.model,p.contextCeiling??true);if(!m)throw Error('等待当前模型的原生窗口信息');return {policy:policyForNewChat(newChatDefaults(),m)};}
    if(op==='setNewChatDefaults'){
      const current=newChatDefaults();if(p.expectedRevision!=null&&p.expectedRevision!==current.revision)throw Error('全局默认已被修改，请重新打开设置后保存。');
      store.data.newChatDefaults={...normalizeNewChatDefaults(p,defaultModel()),revision:current.revision+1,updatedAt:Date.now()};if(!extension.enabled()&&store.data.extensionRestore)delete store.data.extensionRestore.defaults;store.save();return newChatDefaults();
    }
    if(op==='forkBudget'){const m=runtimeModel(p.id,p.model,p.contextCeiling);return {policy:policyForModel(store.data.policies[p.id],runtimeModel(p.id,null,p.contextCeiling)),model:m};}
    if(op==='setContextExtension'){
      if(typeof p.enabled!=='boolean')throw Error('开关值无效');
      const previous=extension.enabled(),status=extensionState();if(p.enabled&&(!status.available||!status.compatible))throw Error('当前模型目录或 Codex 版本不支持拓展');
      if(previous===p.enabled){extension.setEnabled(p.enabled);return extensionState();}
      const oldPolicies=structuredClone(store.data.policies),oldDefaults=store.data.newChatDefaults,oldRestore=store.data.extensionRestore;const before=newChatDefaults();
      try{extension.setEnabled(p.enabled);
        const next=transitionExtensionBudgets({policies:oldPolicies,defaults:before,restore:oldRestore},p.enabled,id=>modelFor(id),defaultModel());
        store.data.policies=next.policies;store.data.newChatDefaults=next.defaults;
        if(next.restore)store.data.extensionRestore=next.restore;else delete store.data.extensionRestore;
        store.save();
      }catch(error){store.data.policies=oldPolicies;store.data.newChatDefaults=oldDefaults;store.data.extensionRestore=oldRestore;extension.setEnabled(previous);throw error;}
      return extensionState();
    }
    if(op==='registerBridge'){const first=bridges.size===0;const entry={ids:new Set(),pid:p.pid,version:typeof p.version==='string'?p.version:null,runtimeFixId:typeof p.runtimeFixId==='string'?p.runtimeFixId:null,contextCeiling:p.contextCeiling===CONTEXT_CEILING_VERSION?CONTEXT_CEILING_VERSION:null,contextCatalogRevision:p.contextCatalogRevision===2?2:null,newChatDefaultsVersion:[1,2].includes(p.newChatDefaultsVersion)?p.newChatDefaultsVersion:null};bridges.set(peer,entry);if(first)ensureMenuBarEntry();peer.socket.on('close',()=>{bridges.delete(peer);rebuildOwners();for(const id of entry.ids){if(!owners.has(id)&&store.data.threads[id])Object.assign(store.data.threads[id],{freshUsage:false,usageFresh:false,phase:'disconnected',message:'连接已断开；显示的是上次观测值。'});}store.save();});return {ok:true};}
    if(op==='updateThread') {
      const b=bridges.get(peer);if(!b)throw new Error('未注册运行时连接');
      if(typeof p.id!=='string'||p.id.length>180||['__proto__','constructor','prototype'].includes(p.id))throw new Error('聊天 ID 无效');
      b.ids.add(p.id);rebuildOwners();
      const allowed=['id','name','cwd','model','status','ephemeral','canAcceptDirectInput','observedWindow','expectedWindow','configuredWindow','lastUsage','freshUsage','usageFresh','phase','message','turnId','revision','observedAt','forkedFromId'];
      const clean=Object.fromEntries(allowed.filter(k=>Object.hasOwn(p,k)).map(k=>[k,p[k]]));
      if(!Object.hasOwn(clean,'usageFresh'))clean.usageFresh=clean.freshUsage===true;
      if(typeof clean.name==='string'&&(clean.name.length>120||/[\r\n]/.test(clean.name)))clean.name=null;
      if(!Object.hasOwn(store.data.policies,p.id)&&!p.ephemeral&&p.canAcceptDirectInput!==false&&p.forkedFromId!==p.id){
        const inherited=inheritedForkPolicy(p.forkPolicy,p.forkedFromId);
        if(inherited)store.data.policies[p.id]={...inherited,updatedAt:Date.now()};
      }
      store.data.threads[p.id]={...store.data.threads[p.id],...clean,observedAt:Date.now()};
      if(bridgeReady(b)&&store.data.policies[p.id])store.data.policies[p.id]=policyForModel(store.data.policies[p.id],modelFor(p.id,clean.model));
      // Desktop-created forks may bypass this bridge's thread/fork RPC. Resolve
      // their native parent metadata before replying with the auto-apply policy.
      store.refreshMetadata();store.inheritDiscoveredForks();
      if(!Object.hasOwn(store.data.policies,p.id)&&p.newChatPolicy&&b.newChatDefaultsVersion!=null&&!p.ephemeral&&p.canAcceptDirectInput!==false&&!store.data.threads[p.id].forkedFromId){store.data.policies[p.id]={...persistedNewChatPolicy(p.newChatPolicy,runtimeModel(p.id,clean.model,b.contextCeiling===CONTEXT_CEILING_VERSION)),updatedAt:Date.now()};}
      Object.assign(store.data.threads[p.id],reconcileWindowConfirmation(store.data.threads[p.id],store.data.policies[p.id],modelFor(p.id)));store.save();
      return {policy:bridgeReady(b)?store.data.policies[p.id]||null:null,model:runtimeModel(p.id,clean.model,b.contextCeiling===CONTEXT_CEILING_VERSION)};
    }
    if(op==='preflight') {
      if((owners.get(p.id)||[]).some(peer=>!bridgeReady(bridges.get(peer))))return {code:'runtime_restart_required',allowed:false,message:'请完整退出并重开 Codex，加载修正后的模型目录。'};
      const policy=normalizePolicy(p.policy);const t=store.data.threads[p.id];
      return preflight(t,policy,modelFor(p.id,t?.model));
    }
    if(op==='setPolicy') {
      const t=Object.hasOwn(store.data.threads,p.id)?store.data.threads[p.id]:null;if(!t)throw new Error('未找到聊天');
      const peers=owners.get(p.id)||[];if(peers.some(peer=>!bridgeReady(bridges.get(peer))))throw Error('当前 Codex 连接尚未加载修正后的模型目录，请完整退出并重新打开 Codex。');
      const policy=normalizePolicy(p.policy);const plan=preflight(t,policy,modelFor(t.id,t.model));
      if(['above_catalog_maximum','above_safe_compact','below_retained_floor','unsupported_thread'].includes(plan.code))throw new Error(plan.message);
      const previous=store.data.policies[p.id];
      if(p.expectedRevision!=null&&p.expectedRevision!==(previous?.revision||0))throw new Error('设置已在另一窗口更新，请刷新后重试');
      const meta=modelFor(t.id,t.model);
      const saved={...policy,...(meta?{effectivePercent:meta.effective_context_window_percent}:{}),...(meta?.context_ceiling?{contextCeilingVersion:CONTEXT_CEILING_VERSION,effectivePercent:meta.effective_context_window_percent}:{}),revision:(previous?.revision||0)+1,enabled:p.apply!==false,updatedAt:Date.now()};
      store.data.policies[p.id]=saved;
      if(!extension.enabled()&&store.data.extensionRestore?.policies)delete store.data.extensionRestore.policies[p.id];
      const candidates=owners.get(p.id)||[];
      Object.assign(t,{phase:p.apply===false?'saved':candidates.length===1?'queued':'waiting_bridge',message:p.apply===false?'已保存；尚未请求应用。':candidates.length>1?'多个运行时加载了此聊天，请先关闭其中一个。':'等待接入 Codex 的连接。'});
      store.save();
      if(saved.enabled&&candidates.length===1){await candidates[0].call('setPolicy',{id:p.id,policy:saved,model:modelFor(t.id,t.model)});}
      return {policy:saved,plan,thread:publicThread(p.id)};
    }
    if(op==='clearPolicy'){
      if(!Object.hasOwn(store.data.threads,p.id))throw new Error('未找到聊天');
      if(!extension.enabled()&&store.data.extensionRestore?.policies)delete store.data.extensionRestore.policies[p.id];
      const previous=store.data.policies[p.id];if(previous)store.data.policies[p.id]={...previous,enabled:false,revision:previous.revision+1};store.save();
      const candidates=owners.get(p.id)||[];for(const candidate of candidates)await candidate.call('clearPolicy',{id:p.id,revision:store.data.policies[p.id]?.revision});
      return {ok:true,message:'已停止后续自动应用；当前运行时窗口保持现值。'};
    }
    if(op==='compact'){
      const candidates=owners.get(p.id)||[];if(candidates.length!==1)throw new Error('需要唯一的已接入运行时');
      return candidates[0].call('compact',{id:p.id},30000);
    }
    if(op==='hook') {
      const found=Object.values(store.data.threads).find(t=>t.id===p.sessionId&&(!p.turnId||t.turnId===p.turnId));
      const t=found?publicThread(found.id):null;
      if(!t)return {};
      const policy=store.data.policies[t.id];const fmt=n=>Number.isSafeInteger(n)?n.toLocaleString('en-US'):'待观测';
      const lines=[`Context Control｜实际窗口 ${fmt(t.observedWindow)}｜最近请求 ${fmt(t.lastUsage?.totalTokens)}（占用估算）`];
      if(policy){const budget=savedBudget(policy,modelFor(t.id,t.model));lines.push(`目标可用 ${fmt(budget?.usableWindow)}｜压缩 ${budget?.compactPercent??'待识别'}%（${fmt(budget?.compact)}）｜${t.message||t.phase||'等待接入'}`);}
      else lines.push('未设置该聊天的独立预算。');
      return {systemMessage:lines.join('\n')};
    }
    throw new Error('不支持的操作');
  }
  const ipcServer=net.createServer(socket=>{let peer;peer=new Peer(socket,(op,p)=>handle(peer,op,p));});
  await new Promise((resolve,reject)=>{ipcServer.once('error',reject);ipcServer.listen(socketPath,resolve);});fs.chmodSync(socketPath,0o600);
  const token=crypto.randomBytes(32).toString('hex');
  const web=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    const expected=Buffer.from(`Bearer ${token}`),actual=Buffer.from(req.headers.authorization||'');
    if(!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host||'')||req.headers.origin||actual.length!==expected.length||!crypto.timingSafeEqual(actual,expected)){res.writeHead(403);res.end('Forbidden');return;}
    try {
      let body='';for await(const data of req){body+=data;if(body.length>65536)throw new Error('请求过大');}
      const params=body?JSON.parse(body):{};const route=req.url;
      let answer;
      if(req.method==='GET'&&route==='/state')answer=state();
      else if(req.method==='POST'&&route==='/context-stats'){
        if(!Object.hasOwn(store.data.threads,params.id))throw new Error('未找到所选聊天');
        answer=await contextStatistics(params.id,params.refresh===true);
      }
      else if(req.method==='POST'&&route==='/context-extension')answer=await handle(null,'setContextExtension',params);
      else if(req.method==='POST'&&route==='/new-chat-defaults')answer=await handle(null,'setNewChatDefaults',params);
      else if(req.method==='POST'&&route==='/runtime-fix')answer=runtimeFix.setEnabled(params.enabled,undefined,[...bridges.values()]);
      else if(req.method==='POST'&&route==='/preflight')answer=await handle(null,'preflight',params);
      else if(req.method==='POST'&&route==='/policy')answer=await handle(null,'setPolicy',params);
      else if(req.method==='POST'&&route==='/clear')answer=await handle(null,'clearPolicy',params);
      else if(req.method==='POST'&&route==='/compact')answer=await handle(null,'compact',params);
      else{res.writeHead(404);res.end();return;}
      res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(answer));
    }catch(error){res.writeHead(400,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error:error.message}));}
  });
  await new Promise((resolve,reject)=>{web.once('error',reject);web.listen(0,'127.0.0.1',resolve);});
  atomicJSON(path.join(root,'connection.json'),{port:web.address().port,token,pid:process.pid});
  const shutdown=()=>{for(const p of bridges.keys())p.socket.destroy();ipcServer.close();web.close();try{fs.unlinkSync(socketPath);}catch{}try{fs.unlinkSync(path.join(root,'connection.json'));}catch{};process.exit(0);};
  process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
  return {ipcServer,web,store};
}
if(process.argv[1]&&import.meta.url===new URL(`file://${process.argv[1]}`).href)startDaemon().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
