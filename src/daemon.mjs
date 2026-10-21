import net from 'node:net';
import {createRunningSpeedCache} from './running-speed.mjs';
import {runningThread} from './tray-state.mjs';
import {createTaskQueues} from './task-queues.mjs';
import {supportsTaskQueues,QUEUE_RUNTIME_RESTART} from './core/queue-runtime.mjs';
import {createQueueSleepInhibitor} from './queue-sleep.mjs';
import {createCompensationManager} from './compaction-compensation.mjs';
import {normalizeBudgetCommand} from './core/budget-command.mjs';
import {CONTROL_API_VERSION,controlOperation} from './contracts/control-api.mjs';
import {createQuotaManager} from './account-quota.mjs';
import {createQuotaAnalyticsService} from './quota-analytics-service.mjs';
import {createCloudSync} from './cloud-sync.mjs';
import {version,buildId} from './version.mjs';
import {cleanupOldRuntimes} from './runtime-cleanup.mjs';
import os from 'node:os';
import {createUpdateManager} from './updates.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {defaultRoot,prepareEndpoint,secureEndpoint,windows} from './platform/index.mjs';
import {authenticateServer} from './ipc-auth.mjs';
import {L} from './localization.mjs';
import {Peer,request} from './ipc.mjs';
import {root,socketPath,ensureRoot,atomicJSON,ipcKey} from './paths.mjs';
import {compareThreadActivity,mergeActivity} from './thread-activity.mjs';
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
  prepareEndpoint(socketPath);
  const store=new Store();await store.seedRecentMetadata();
  for(const t of Object.values(store.data.threads)){t.freshUsage=false;t.usageFresh=false;t.phase='disconnected';}
  store.save();
  const bridges=new Map();const owners=new Map();
  const quotaAnalytics=createQuotaAnalyticsService();
  const quota=createQuotaManager({home:root,onObservation:observation=>quotaAnalytics.record(observation)});
  const cloudSync=createCloudSync({home:root,analytics:quotaAnalytics,prepare:()=>quota.refresh(true)});
  const queueFile=path.join(root,'task-queues.json');
  function queuePeers(id){const ownersForThread=owners.get(id)||[];return ownersForThread.length?ownersForThread:[...bridges.keys()].filter(peer=>supportsTaskQueues(bridges.get(peer)));}
  function queueSupported(id){const peers=queuePeers(id);return peers.length===1&&supportsTaskQueues(bridges.get(peers[0]));}
  function queueRestartRequired(id){const peers=(owners.get(id)||[]).length?owners.get(id):[...bridges.keys()];return peers.length===1&&!supportsTaskQueues(bridges.get(peers[0]));}
  const queueCall=(id,op,params)=>{const peers=queuePeers(id);if(peers.length!==1)throw Error('需要唯一的已接入运行时');if(!queueSupported(id))throw Error(QUEUE_RUNTIME_RESTART);return peers[0].call(op,{id,...params},30000);};
  const taskQueues=createTaskQueues({load:()=>{try{return JSON.parse(fs.readFileSync(queueFile,'utf8'));}catch{return {};}},save:value=>atomicJSON(queueFile,value),quota,thread:id=>Object.hasOwn(store.data.threads,id)?{...store.publicThread(id,owners),taskQueueSupported:queueSupported(id),taskQueueRestartRequired:queueRestartRequired(id),queueCanLoad:!(owners.get(id)||[]).length&&queueSupported(id)}:null,prepare:id=>queueCall(id,'queue-prepare',{}),start:(id,task)=>queueCall(id,'queue-start',{task}),interrupt:(id,executionId)=>queueCall(id,'queue-interrupt',{executionId}),inhibit:createQueueSleepInhibitor()});
  let analyticsTimer;
  if(root===defaultRoot()){const scan=async()=>{let delay=10000;try{const progress=await quotaAnalytics.scan();if(progress.pending)delay=1000;}catch{}analyticsTimer=setTimeout(scan,delay);analyticsTimer.unref();};analyticsTimer=setTimeout(scan,3000);analyticsTimer.unref();}
  if(root===defaultRoot()){const initial=setTimeout(()=>quota.refresh().catch(()=>{}),1500);initial.unref();const polling=setInterval(()=>quota.refresh().catch(()=>{}),10000);polling.unref();}
  const updater=createUpdateManager({current:JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url))).version});
  if(root===defaultRoot()){const timer=setTimeout(()=>updater.check().catch(()=>{}),5000);timer.unref();const interval=setInterval(()=>updater.check().catch(()=>{}),6*60*60*1000);interval.unref();}
  const contextStatistics=createContextStatisticsService();
  const responseSpeeds=createRunningSpeedCache(id=>contextStatistics.speed(id));
  const statisticsJSON=new WeakMap();
  const runtimeFix=createRuntimeFixManager();
  const extension=createContextExtensionManager();
  const compensation=createCompensationManager();
  function rebuildOwners(){owners.clear();for(const [peer,b]of bridges)for(const id of b.ids){if(!owners.has(id))owners.set(id,[]);owners.get(id).push(peer);}}
  function nativeDefaultModel(){store.model(null);return [...(store.catalog?.values()||[])].filter(m=>Number.isSafeInteger(m.max_context_window)&&Number.isInteger(m.effective_context_window_percent)).sort((a,b)=>b.max_context_window*b.effective_context_window_percent-a.max_context_window*a.effective_context_window_percent)[0]||null;}
  function defaultModel(){const m=nativeDefaultModel();return extension.enabled()?ceilingModel(m):m;}
  function modelFor(id,slug){const m=store.model(slug??store.publicThread(id,owners).model);return extension.enabled()?ceilingModel(m):m;}
  function bridgeReady(b){return !!b&&(extension.enabled()?b.contextCeiling===CONTEXT_CEILING_VERSION&&b.contextCatalogRevision===2:b.contextCeiling!==CONTEXT_CEILING_VERSION);}
  function runtimeModel(id,slug,extended){const m=store.model(slug??store.data.threads[id]?.model)||nativeDefaultModel();if(typeof extended!=='boolean'){const peers=owners.get(id)||[];extended=peers.length===1?bridges.get(peers[0])?.contextCeiling===CONTEXT_CEILING_VERSION:extension.enabled();}return extended?ceilingModel(m):m;}
  function extensionState(fix=runtimeFix.status()){return extension.status([...bridges.values()],{compatible:!!fix.originalVersion,available:!!nativeDefaultModel()});}
  function publicThread(id,extensionStatus){const t=store.publicThread(id,owners),m=modelFor(id,t.model),peers=owners.get(id)||[];const ready=peers.length===0?!!m:peers.length===1&&bridgeReady(bridges.get(peers[0]));return {...t,responseSpeed:runningThread(t)?responseSpeeds.get(id):null,taskQueueSupported:queueSupported(id),taskQueueRestartRequired:queueRestartRequired(id),queueCanLoad:!peers.length&&queueSupported(id),policy:policyForModel(t.policy,m,{revise:false}),...(!ready&&peers.length?{phase:'extension_pending',message:(extensionStatus??extensionState()).message}:{}),modelMetadata:m?Object.fromEntries(['max_context_window','context_window','effective_context_window_percent','context_ceiling','context_compact_ceiling'].map(k=>[k,m[k]]).concat([['context_catalog_ready',ready]])):null};}
  function newChatDefaults(){return clampNewChatDefaults(store.data.newChatDefaults||(extension.enabled()?initialNewChatDefaults:nativeNewChatDefaults),defaultModel());}
  function state(){
    store.refreshMetadata();const fix=runtimeFix.status(undefined,[...bridges.values()]),ext=extensionState(fix);
    const threads=Object.keys(store.data.threads).map(id=>publicThread(id,ext)).filter(t=>!t.archived&&t.ephemeral!==true&&t.canAcceptDirectInput!==false&&(t.threadSource==null||t.threadSource==='user')).sort(compareThreadActivity);
    // Keep background monitoring light: speed sampling is needed only while the tray menu is visible.
    try{if(JSON.parse(fs.readFileSync(path.join(root,'ui-status.json'),'utf8')).menuWindowVisible===true)responseSpeeds.observe(threads);}catch{}
    return {apiVersion:CONTROL_API_VERSION,capabilities:{visibleBudget:true,quotaAnalytics:true,creditBaseline:true,taskQueues:true,compactionCompensation:false},taskQueues:taskQueues.list(),queueModels:[...(store.catalog?.values()??[])].filter(m=>m.visibility!=='hidden').map(m=>({id:m.slug,name:m.display_name||m.slug,efforts:(m.supported_reasoning_levels??[]).map(e=>e.effort),defaultEffort:m.default_reasoning_level??null})),buildId,quota:quota.state(),update:updater.status(),newChatDefaults:newChatDefaults(),newChatDefaultsLimits:newChatDefaultLimits(defaultModel()),newChatDefaultsPending:[...bridges.values()].some(b=>!b.newChatDefaultsVersion),version,bridgeCount:bridges.size,contextExtension:ext,compactionCompensation:compensation.status([...bridges.values()],threads),contextCeilingPending:ext.pending,runtimeFix:fix,bridges:[...bridges.values()].map(b=>({pid:b.pid,version:b.version??null,runtimeFixId:b.runtimeFixId??null})),threads,sidebar:store.projects.sidebar(threads)};
  }
  async function handle(peer,op,p) {
    if(op==='ping')return {ok:true,version,buildId};
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
    if(op==='registerBridge'){const first=bridges.size===0;const entry={ids:new Set(),pid:p.pid,compensationVersion:[1,2,3].includes(p.compensationVersion)?p.compensationVersion:null,taskQueueVersion:p.taskQueueVersion==null?null:p.taskQueueVersion===4?4:0,version:typeof p.version==='string'?p.version:null,runtimeFixId:typeof p.runtimeFixId==='string'?p.runtimeFixId:null,contextCeiling:p.contextCeiling===CONTEXT_CEILING_VERSION?CONTEXT_CEILING_VERSION:null,contextCatalogRevision:p.contextCatalogRevision===2?2:null,newChatDefaultsVersion:[1,2].includes(p.newChatDefaultsVersion)?p.newChatDefaultsVersion:null};bridges.set(peer,entry);if(first)ensureMenuBarEntry();peer.socket.on('close',()=>{bridges.delete(peer);rebuildOwners();for(const id of entry.ids){if(!owners.has(id)&&store.data.threads[id])Object.assign(store.data.threads[id],{freshUsage:false,usageFresh:false,phase:'disconnected',message:'连接已断开；显示的是上次观测值。'});}store.save();});return {ok:true};}
    if(op==='updateThread') {
      const b=bridges.get(peer);if(!b)throw new Error('未注册运行时连接');
      if(typeof p.id!=='string'||p.id.length>180||['__proto__','constructor','prototype'].includes(p.id))throw new Error('聊天 ID 无效');
      const previousPolicy=JSON.stringify(store.data.policies[p.id]??null);
      const hadOwner=b.ids.has(p.id);
      b.ids.add(p.id);rebuildOwners();
      const allowed=['id','name','cwd','model','status','ephemeral','canAcceptDirectInput','observedWindow','expectedWindow','configuredWindow','lastUsage','freshUsage','usageFresh','phase','message','turnId','revision','observedAt','forkedFromId','threadSource','automaticTask','compensation'];
      const clean=Object.fromEntries(allowed.filter(k=>Object.hasOwn(p,k)).map(k=>[k,p[k]]));
      if(!Object.hasOwn(clean,'usageFresh'))clean.usageFresh=clean.freshUsage===true;
      if(clean.threadSource!=null&&typeof clean.threadSource!=='string')delete clean.threadSource;
      if(typeof clean.name==='string'&&(clean.name.length>120||/[\r\n]/.test(clean.name)))clean.name=null;
      if(!Object.hasOwn(store.data.policies,p.id)&&!p.ephemeral&&p.canAcceptDirectInput!==false&&p.forkedFromId!==p.id){
        const inherited=inheritedForkPolicy(p.forkPolicy,p.forkedFromId);
        if(inherited)store.data.policies[p.id]={...inherited,updatedAt:Date.now()};
      }
      const activity=mergeActivity(store.data.threads[p.id],p,{allowLegacyTransition:hadOwner});
      store.data.threads[p.id]={...store.data.threads[p.id],...clean,...activity,observedAt:Date.now()};
      if(bridgeReady(b)&&store.data.policies[p.id])store.data.policies[p.id]=policyForModel(store.data.policies[p.id],modelFor(p.id,clean.model));
      // Desktop-created forks may bypass this bridge's thread/fork RPC. Resolve
      // their native parent metadata before replying with the auto-apply policy.
      store.refreshMetadata();const inherited=store.inheritDiscoveredForks();
      if(!Object.hasOwn(store.data.policies,p.id)&&p.newChatPolicy&&b.newChatDefaultsVersion!=null&&!p.ephemeral&&p.canAcceptDirectInput!==false&&!store.data.threads[p.id].forkedFromId){store.data.policies[p.id]={...persistedNewChatPolicy(p.newChatPolicy,runtimeModel(p.id,clean.model,b.contextCeiling===CONTEXT_CEILING_VERSION)),updatedAt:Date.now()};}
      Object.assign(store.data.threads[p.id],reconcileWindowConfirmation(store.data.threads[p.id],store.data.policies[p.id],modelFor(p.id)));
      if(inherited||previousPolicy!==JSON.stringify(store.data.policies[p.id]??null))store.save();else store.scheduleSave();
      // Completion still reconciles when monitoring was switched off mid-turn.
      void taskQueues.tick();
      return {policy:bridgeReady(b)?store.data.policies[p.id]||null:null,model:runtimeModel(p.id,clean.model,b.contextCeiling===CONTEXT_CEILING_VERSION)};
    }
    if(op==='preflight') {
      if((owners.get(p.id)||[]).some(peer=>!bridgeReady(bridges.get(peer))))return {code:'runtime_restart_required',allowed:false,message:'请完整退出并重开 Codex，加载修正后的模型目录。'};
      const t=store.data.threads[p.id];const policy=normalizeBudgetCommand(p,modelFor(p.id,t?.model));
      return preflight(t,policy,modelFor(p.id,t?.model));
    }
    if(op==='setPolicy') {
      const t=Object.hasOwn(store.data.threads,p.id)?store.data.threads[p.id]:null;if(!t)throw new Error('未找到聊天');
      const peers=owners.get(p.id)||[];if(peers.some(peer=>!bridgeReady(bridges.get(peer))))throw Error('当前 Codex 连接尚未加载修正后的模型目录，请完整退出并重新打开 Codex。');
      const policy=normalizeBudgetCommand(p,modelFor(t.id,t.model));const plan=preflight(t,policy,modelFor(t.id,t.model));
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
      const policy=store.data.policies[t.id];const fmt=n=>Number.isSafeInteger(n)?n.toLocaleString('en-US'):L('待观测');
      const lines=[L('Context Control｜实际窗口 {0}｜最近请求 {1}（占用估算）',fmt(t.observedWindow),fmt(t.lastUsage?.totalTokens))];
      if(policy){const budget=savedBudget(policy,modelFor(t.id,t.model));lines.push(L('目标可用 {0}｜压缩 {1}%（{2}）｜{3}',fmt(budget?.usableWindow),budget?.compactPercent??L('待识别'),fmt(budget?.compact),L(t.message||t.phase||'等待接入')));}
      else lines.push(L('未设置该聊天的独立预算。'));
      return {systemMessage:lines.join('\n')};
    }
    throw new Error('不支持的操作');
  }
  const key=ipcKey(true);
  const ipcServer=net.createServer(async socket=>{try{if(key)await authenticateServer(socket,key);let peer;peer=new Peer(socket,(op,p)=>handle(peer,op,p));}catch{socket.destroy();}});
  await new Promise((resolve,reject)=>{ipcServer.once('error',reject);ipcServer.listen(socketPath,resolve);});secureEndpoint(socketPath);
  const token=crypto.randomBytes(32).toString('hex');
  const web=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    const expected=Buffer.from(`Bearer ${token}`),actual=Buffer.from(req.headers.authorization||'');
    if(!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host||'')||req.headers.origin||actual.length!==expected.length||!crypto.timingSafeEqual(actual,expected)){res.writeHead(403);res.end('Forbidden');return;}
    try {
      let body='';for await(const data of req){body+=data;if(body.length>65536)throw new Error('请求过大');}
      const params=body?JSON.parse(body):{};const route=req.url;
      let answer;const operation=controlOperation(req.method,route);
      if(operation==='state')answer=state();
      else if(operation==='cloud-sync')answer=await cloudSync.command(params);
      else if(operation==='task-queue'){if(params.action==='enable'&&params.enabled&&typeof params.id==='string'&&Object.hasOwn(store.data.threads,params.id)&&!(owners.get(params.id)||[]).length&&queueSupported(params.id))await queueCall(params.id,'queue-prepare',{});answer=taskQueues.command(params);}
      else if(operation==='quota-refresh')answer=await quota.refresh(true);
      else if(operation==='quota-credit-baseline')answer=quota.resetCredits(params.id,params.legacy??null);
      else if(operation==='quota-analytics'){
        if(params.days!=null&&![28,56,84].includes(params.days))throw Error('Invalid quota history range');
        if(params.scope!=null&&(typeof params.scope!=='string'||params.scope.length>80))throw Error('Invalid quota history scope');
        if(params.pool!=null&&(typeof params.pool!=='string'||params.pool.length>160))throw Error('Invalid quota pool');
        if(params.model!=null&&(typeof params.model!=='string'||params.model.length>160))throw Error('Invalid quota model');
        if(params.costDate!=null&&(typeof params.costDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(params.costDate)||!Number.isFinite(Date.parse(params.costDate))||new Date(params.costDate).toISOString().slice(0,10)!==params.costDate))throw Error('Invalid cost date');
        if(params.costStart!=null||params.costEnd!=null){if(!Number.isSafeInteger(params.costStart)||!Number.isSafeInteger(params.costEnd)||params.costStart<0||params.costEnd<=params.costStart||params.costEnd-params.costStart>366*86400000||params.costStart>Date.now())throw Error('Invalid cost time range');}
        if(params.outlookSmoothing!=null&&![0,3,5,9].includes(params.outlookSmoothing))throw Error('Invalid smoothing window');
        if(params.outlookOverlayCount!=null&&(!Number.isSafeInteger(params.outlookOverlayCount)||params.outlookOverlayCount<1||params.outlookOverlayCount>12))throw Error('Invalid overlay cycle count');
        if(params.outlookStart!=null||params.outlookEnd!=null){if(!Number.isSafeInteger(params.outlookStart)||!Number.isSafeInteger(params.outlookEnd)||params.outlookStart<0||params.outlookEnd<=params.outlookStart||params.outlookEnd-params.outlookStart>366*86400000)throw Error('Invalid outlook time range');}
        if(root===defaultRoot())await quota.refresh(params.refresh===true).catch(()=>{});
        answer=await quotaAnalytics.report({days:params.days??28,scope:params.scope,pool:params.pool,model:params.model,outlookOverlayCount:params.outlookOverlayCount,outlookSmoothing:params.outlookSmoothing,outlookStart:params.outlookStart,outlookEnd:params.outlookEnd,costDate:params.costDate,costStart:params.costStart,costEnd:params.costEnd,refresh:params.refresh===true,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone});
      }
      else if(operation==='shutdown'){if(Object.values(store.data.threads).some(t=>t.phase==='reloading'))throw Error('A budget transaction is still active');answer={ok:true};setTimeout(shutdown,100).unref();}
      else if(operation==='check-update')answer=await updater.check(true);
      else if(operation==='install-update')answer=await updater.install();
      else if(operation==='scan'){await store.scanLocal();answer=state();}
      else if(operation==='statistics'){
        if(!Object.hasOwn(store.data.threads,params.id))throw new Error('未找到所选聊天');
        answer=await contextStatistics(params.id,params.refresh===true);
      }
      else if(operation==='compensation'){compensation.setEnabled(params.enabled);answer=state().compactionCompensation;}
      else if(operation==='extension')answer=await handle(null,'setContextExtension',params);
      else if(operation==='defaults')answer=await handle(null,'setNewChatDefaults',params);
      else if(operation==='runtime-fix')answer=runtimeFix.setEnabled(params.enabled,undefined,[...bridges.values()]);
      else if(operation==='preflight')answer=await handle(null,'preflight',params);
      else if(operation==='policy')answer=await handle(null,'setPolicy',params);
      else if(operation==='clear')answer=await handle(null,'clearPolicy',params);
      else if(operation==='compact')answer=await handle(null,'compact',params);
      else{res.writeHead(404);res.end();return;}
      let serialized;
      if(route==='/context-stats'){
        serialized=statisticsJSON.get(answer);if(serialized==null){serialized=JSON.stringify(answer);statisticsJSON.set(answer,serialized);}
      }else serialized=JSON.stringify(answer);
      res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(serialized);
    }catch(error){res.writeHead(400,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error:error.message}));}
  });
  await new Promise((resolve,reject)=>{web.once('error',reject);web.listen(0,'127.0.0.1',resolve);});
  atomicJSON(path.join(root,'connection.json'),{port:web.address().port,token,pid:process.pid,script:fileURLToPath(import.meta.url),executable:process.execPath,buildId});
  const cleanup=()=>{try{cleanupOldRuntimes();}catch{}};
  const cleanupStart=setTimeout(cleanup,30000);cleanupStart.unref();
  const cleanupTimer=setInterval(cleanup,5*60*1000);cleanupTimer.unref();
  const scanTimer=setInterval(()=>store.refreshMetadata(),15000);scanTimer.unref();
  web.once('close',()=>{cloudSync.close();clearTimeout(analyticsTimer);quotaAnalytics.close();taskQueues.close();});
  const shutdown=()=>{responseSpeeds.close();contextStatistics.close();try{store.flush();}catch{}for(const p of bridges.keys())p.socket.destroy();ipcServer.close();web.close();try{prepareEndpoint(socketPath);}catch{}try{fs.unlinkSync(path.join(root,'connection.json'));}catch{};process.exit(0);};
  process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
  return {ipcServer,web,store};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1]))startDaemon().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
