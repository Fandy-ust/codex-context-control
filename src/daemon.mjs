import {hotChatIds,HOT_CHAT_LIMIT} from './core/hot-chats.mjs';
import {CodexRestore} from './codex-restore.mjs';
import {CodexPowerProtection} from './codex-power-protection.mjs';
import {createPassiveQuotaStore} from './passive-quota-store.mjs';
import {stopForCredits} from './credits-stop.mjs';
import {createCreditsProtection} from './credits-protection.mjs';
import {integrationLog} from './diagnostic-log.mjs';
import net from 'node:net';
import {createAccountSwitcher} from './account-switch.mjs';
import {createQueueAccountSwitch} from './queue-account-switch.mjs';
import {accountQuotaViews} from './core/account-quota-link.mjs';
import {accountProcessBlocker,accountProcesses,automaticAccountProcesses,stopAccountProcesses,openAccountDesktop} from './account-processes.mjs';
import {codexLaunchEnvironment} from './windows-integration.mjs';
import {accountTaskBlockers} from './core/account-switch-blockers.mjs';
import {createQuotaActivation} from './quota-activation.mjs';
import {runQuotaProbe} from './quota-probe.mjs';
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
import {root,codexHome,socketPath,ensureRoot,atomicJSON,readJSON,ipcKey} from './paths.mjs';
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
import {contextSnapshot,contextPreflight} from './core/context-snapshot.mjs';
import {speedReport} from './core/speed-report.mjs';
import {createContextOperations,contextError} from './context-operations.mjs';

export async function startDaemon() {
  const launchDesktop=()=>openAccountDesktop({environment:windows?codexLaunchEnvironment():process.env});
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
  const powerProtection=new CodexPowerProtection({home:codexHome,directory:path.join(root,'power-protection','codex'),isRunning:()=>accountProcesses().length>0});
  const codexRestore=new CodexRestore({home:codexHome,directory:powerProtection.directory,isRunning:()=>accountProcesses().length>0,reopen:launchDesktop,close:()=>stopAccountProcesses(),prepareClose:()=>{taskQueues.command({action:'monitoring',enabled:false});quotaActivation.command({action:'cancel'});}});
  powerProtection.hold=()=>codexRestore.active;
  codexRestore.start();powerProtection.start();
  prepareEndpoint(socketPath);
  const store=new Store();await store.seedRecentMetadata();
  for(const t of Object.values(store.data.threads)){t.freshUsage=false;t.usageFresh=false;t.phase='disconnected';}
  store.save();
  const bridges=new Map();const owners=new Map();
  const operations=createContextOperations({load:()=>readJSON(path.join(root,'context-operations.json'),[]),save:values=>atomicJSON(path.join(root,'context-operations.json'),values)});
  const quotaAnalytics=createQuotaAnalyticsService();
  const passiveQuota=createPassiveQuotaStore({home:root});
  const quota=createQuotaManager({read:()=>passiveQuota.read(),home:root,isConnected:at=>[...bridges.values()].some(b=>b.quotaObservedAt===at),onObservation:async observation=>{const scope=await quotaAnalytics.record(observation);await cloudSync.command({action:'status'}).catch(()=>{});return scope;}});
  let creditsProtection=null;
  const activationFile=path.join(root,'quota-activation.json');
  const quotaActivation=createQuotaActivation({load:()=>{try{return readJSON(activationFile,{});}catch{return {};}},save:value=>atomicJSON(activationFile,value),quota,probe:runQuotaProbe,protection:()=>creditsProtection?.state()??null,recommend:()=>quotaAnalytics.activationRecommendation()});
  let accountTransition=false,queueAccountAuto=null,autoPrepared=[];
  const activationTimer=setInterval(()=>{if(!accountTransition&&!queueAccountAuto?.state().busy)void quotaActivation.tick().catch(()=>{});},10000);activationTimer.unref();
  const cloudSync=createCloudSync({home:root,analytics:quotaAnalytics,quotaAccounts:()=>quota.state().accounts,prepare:()=>quota.refresh(true),removeQuotaAccounts:scopes=>quota.removeAccounts(scopes)});
  // Hydrate saved accounts without opening a new ledger in an empty installation.
  if(fs.existsSync(path.join(root,'quota-history.sqlite')))void cloudSync.command({action:'status'}).catch(()=>{});
  function accountQuotaState(){
    const value=quota.state(),profiles=cloudSync.state().accounts,result=new Map();
    for(const profile of profiles){const candidates=value.accounts.filter(a=>profile.scopes?.includes(a.scope));if(profile.quota)candidates.push(profile.quota);if(profile.remoteQuota&&!profile.scopes?.includes(value.accountScope))candidates.push(profile.remoteQuota);candidates.sort((a,b)=>b.updatedAt-a.updatedAt);const account=candidates[0]||{scope:profile.scopes?.[0]||'cloud:'+profile.id,buckets:[],updatedAt:null};if(account)result.set(profile.id,{...account,current:profile.scopes?.includes(value.accountScope)||false,label:profile.customName||profile.label||account.label,email:profile.label||account.label,showQuota:profile.showQuota!==false,creditBaselines:account.remote?account.creditBaselines||{}:value.accounts.find(a=>a.scope===account.scope)?.creditBaselines||{},sourceName:cloudSync.state().deviceList?.find(d=>d.id===account.sourceDevice)?.name});}
    for(const account of value.accounts)if(!profiles.some(p=>p.scopes?.includes(account.scope)))result.set(account.scope,account);
    const observed={...value,accounts:[...result.values()].sort((a,b)=>Number(b.current)-Number(a.current)||b.updatedAt-a.updatedAt)};
    return accountQuotaViews(accountSwitcher.state(),observed).quota;
  }
  const queueFile=path.join(root,'task-queues.json');
  function queuePeers(id){const ownersForThread=owners.get(id)||[];return ownersForThread.length?ownersForThread:[...bridges.keys()].filter(peer=>supportsTaskQueues(bridges.get(peer)));}
  function queueSupported(id){const peers=queuePeers(id);return peers.length===1&&supportsTaskQueues(bridges.get(peers[0]));}
  function queueRestartRequired(id){const peers=(owners.get(id)||[]).length?owners.get(id):[...bridges.keys()];return peers.length===1&&!supportsTaskQueues(bridges.get(peers[0]));}
  const queueCall=(id,op,params)=>{const peers=queuePeers(id);if(peers.length!==1)throw Error('需要唯一的已接入运行时');if(!queueSupported(id))throw Error(QUEUE_RUNTIME_RESTART);return peers[0].call(op,{id,...params},30000);};
  const taskQueues=createTaskQueues({creditsConfig:()=>quotaActivation.state().config,load:()=>{try{return readJSON(queueFile,{});}catch{return {};}},save:value=>atomicJSON(queueFile,value),quota,thread:id=>{if(!Object.hasOwn(store.data.threads,id))store.refreshMetadata(false,[id]);return Object.hasOwn(store.data.threads,id)?{...store.publicThread(id,owners),taskQueueSupported:queueSupported(id),taskQueueRestartRequired:queueRestartRequired(id),queueCanLoad:!(owners.get(id)||[]).length&&queueSupported(id)}:null;},prepare:id=>queueCall(id,'queue-prepare',{}),canDispatch:id=>operations.pending(id).some(o=>o.kind==='compact')?'等待已确认的上下文整理':!creditsProtection?.state().busy&&(queueAccountAuto?.dispatchAllowed()??true),operation:(chatId,operationId)=>operations.get(operationId,chatId),canSwitchAccounts:()=>queueAccountAuto?.state().enabled===true,start:(id,task)=>queueCall(id,'queue-start',{task}),interrupt:(id,executionId)=>queueCall(id,'queue-interrupt',{executionId}),inhibit:createQueueSleepInhibitor()});
  const creditsFile=path.join(root,'credits-protection.json');
  creditsProtection=createCreditsProtection({load:()=>readJSON(creditsFile,{}),save:value=>atomicJSON(creditsFile,value),quota,config:()=>quotaActivation.state().config,
    stop:({scope})=>stopForCredits({queues:taskQueues,quota,bridges},scope)});
  const creditsTimer=setInterval(()=>{if(!accountTransition&&!queueAccountAuto?.state().busy)void creditsProtection.tick().catch(()=>{});},3000);creditsTimer.unref();
  let analyticsTimer;
  function switchBlockers({automatic=false}={}){
    for(const [peer,bridge]of bridges){if(Number.isSafeInteger(bridge.pid)&&bridge.pid>0)try{process.kill(bridge.pid,0);}catch(error){if(error.code==='ESRCH'){bridges.delete(peer);peer.socket.destroy();}}}
    rebuildOwners();
    const blockers=accountTaskBlockers({threads:[...owners.keys()].map(id=>({...store.data.threads[id],connected:owners.get(id).length===1})),tasks:automatic?{monitoringEnabled:false}:taskQueues.list(),activation:quotaActivation.state(),sync:cloudSync.state()});
    if(bridges.size||accountProcessBlocker())blockers.push('Codex 或 CLI 会话仍在运行');
    return blockers;
  }
  async function readyForAutoSwitch(){
    const blockers=accountTaskBlockers({threads:[...owners.keys()].map(id=>({...store.data.threads[id],connected:owners.get(id).length===1})),activation:quotaActivation.state(),sync:cloudSync.state()});
    if(blockers.length)throw Error(blockers.join('；'));
    if(quotaActivation.state().busy)throw Error('等待额度探测结束后再自动切换');
    return automaticAccountProcesses({bridges:[...bridges.values()]});
  }
  const accountSwitcher=createAccountSwitcher({home:root,codexHome,openDesktop:launchDesktop,
    quiesce:async()=>{accountTransition=true;let resumeQueues;try{resumeQueues=await taskQueues.suspend();const resume=await quota.suspend();return async()=>{try{for(const peer of autoPrepared)await peer.call('account-release',{},2000).catch(()=>{});}finally{autoPrepared=[];resume();resumeQueues();accountTransition=false;}};}catch(error){resumeQueues?.();accountTransition=false;throw error;}},
    prepareSwitch:async context=>{
      context.shutdownPass=(context.shutdownPass??0)+1;
      integrationLog('account_switch.shutdown',{pass:context.shutdownPass,automatic:context.automatic===true});
      if(context?.automatic){
        if(!context.authorized?.())throw Error('队列状态已变化，自动切换已取消');
        const initial=await readyForAutoSwitch(),registered=[...bridges.values()];
        for(const peer of bridges.keys()){await peer.call('account-prepare',{},5000);autoPrepared.push(peer);}
        if(!context.authorized?.())throw Error('队列状态已变化，自动切换已取消');
        const list=()=>{const values=automaticAccountProcesses({bridges:registered});if(values.some(p=>!initial.some(a=>a.pid===p.pid&&a.executable===p.executable)))throw Error('切换期间出现新会话，已取消自动切换');return values;};
        context.runtimeClosed=true;await stopAccountProcesses({list});
        for(let i=0;i<30&&bridges.size;i++)await new Promise(r=>setTimeout(r,100));
        return;
      }
      taskQueues.command({action:'monitoring',enabled:false});
      taskQueues.command({action:'disable-all'});
      quotaActivation.command({action:'cancel'});
      await stopAccountProcesses();
      for(let i=0;i<30&&(bridges.size||quotaActivation.state().busy);i++)await new Promise(r=>setTimeout(r,100));
    },
    guard:async context=>{
      if(context?.automatic&&!context.authorized?.())throw Error('队列状态已变化，自动切换已取消');
      const blockers=switchBlockers(context);if(blockers.length){integrationLog('account_switch.blocked',{pass:context?.shutdownPass??0,automatic:context?.automatic===true,bridgeCount:bridges.size,processes:accountProcesses().map(({pid,executable})=>({pid,executable})),blockers});throw Error(blockers.join('；'));}
    }});
  function currentQueueAccount(){const q=accountQuotaState();return {id:q.accounts.find(a=>a.current)?.loginId??null,quota:q};}
  const autoSwitchFile=path.join(root,'queue-account-switch.json');
  queueAccountAuto=createQueueAccountSwitch({load:()=>{try{return readJSON(autoSwitchFile,{});}catch{return {};}},save:value=>atomicJSON(autoSwitchFile,value),queues:taskQueues,current:currentQueueAccount,profiles:()=>accountSwitcher.state().profiles,
    inspect:id=>accountSwitcher.inspect(id),ready:readyForAutoSwitch,openDesktop:async()=>{await launchDesktop();accountSwitcher.opened(accountSwitcher.state().activeId);},
    switchAccount:async(id,context)=>{try{return await accountSwitcher.command({action:'switch',id,confirmed:true,open:false},context);}finally{passiveQuota.invalidate();quota.invalidate();}},
    refreshCurrent:async()=>{await quota.refresh(true);return currentQueueAccount();}});
  const accountAutoTimer=setInterval(()=>void queueAccountAuto.tick().catch(()=>{}),3000);accountAutoTimer.unref();
  function taskQueueState(){return {...taskQueues.list(),accountSwitch:queueAccountAuto.state()};}
  if(root===defaultRoot()){const scan=async()=>{let delay=10000;try{const progress=await quotaAnalytics.scan({includeIds:criticalThreadIds()});if(progress.pending)delay=1000;}catch{}analyticsTimer=setTimeout(scan,delay);analyticsTimer.unref();};analyticsTimer=setTimeout(scan,3000);analyticsTimer.unref();}
  if(root===defaultRoot()){const initial=setTimeout(()=>quota.refresh().catch(()=>{}),1500);initial.unref();const polling=setInterval(()=>quota.refresh().catch(()=>{}),10000);polling.unref();}
  const updater=createUpdateManager({current:JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url))).version});
  if(root===defaultRoot()){const timer=setTimeout(()=>updater.check().catch(()=>{}),5000);timer.unref();const interval=setInterval(()=>updater.check().catch(()=>{}),6*60*60*1000);interval.unref();}
  const contextStatistics=createContextStatisticsService(codexHome,{onWorkerError:error=>integrationLog('statistics.worker_error',error)});
  const responseSpeeds=createRunningSpeedCache(id=>contextStatistics.speed(id));
  const statisticsJSON=new WeakMap();
  const runtimeFix=createRuntimeFixManager();
  const extension=createContextExtensionManager();
  const compensation=createCompensationManager();
  function rebuildOwners(){owners.clear();for(const [peer,b]of bridges)for(const id of b.ids){if(!owners.has(id))owners.set(id,[]);owners.get(id).push(peer);}}
  function nativeDefaultModel(){store.model(null);return [...(store.catalog?.values()||[])].filter(m=>Number.isSafeInteger(m.max_context_window)&&Number.isInteger(m.effective_context_window_percent)).sort((a,b)=>b.max_context_window*b.effective_context_window_percent-a.max_context_window*a.effective_context_window_percent)[0]||null;}
  function defaultModel(){const m=nativeDefaultModel();return extension.enabled()?ceilingModel(m):m;}
  function modelFor(id,slug){const m=store.model(slug??store.data.threads[id]?.model);return extension.enabled()?ceilingModel(m):m;}
  function bridgeReady(b){return !!b&&(extension.enabled()?b.contextCeiling===CONTEXT_CEILING_VERSION&&b.contextCatalogRevision===2:b.contextCeiling!==CONTEXT_CEILING_VERSION);}
  function runtimeModel(id,slug,extended){const m=store.model(slug??store.data.threads[id]?.model)||nativeDefaultModel();if(typeof extended!=='boolean'){const peers=owners.get(id)||[];extended=peers.length===1?bridges.get(peers[0])?.contextCeiling===CONTEXT_CEILING_VERSION:extension.enabled();}return extended?ceilingModel(m):m;}
  function extensionState(fix=runtimeFix.status()){return extension.status([...bridges.values()],{compatible:!!fix.originalVersion,available:!!nativeDefaultModel()});}
  function publicThread(id,extensionStatus,refreshMetadata=true){const t=store.publicThread(id,owners,{refreshMetadata}),m=modelFor(id,t.model),peers=owners.get(id)||[];const ready=peers.length===0?!!m:peers.length===1&&bridgeReady(bridges.get(peers[0]));return {...t,responseSpeed:runningThread(t)?responseSpeeds.get(id):null,taskQueueSupported:queueSupported(id),taskQueueRestartRequired:queueRestartRequired(id),queueCanLoad:!peers.length&&queueSupported(id),policy:policyForModel(t.policy,m,{revise:false}),...(!ready&&peers.length?{phase:t.ambiguous?'connection_conflict':'extension_pending',message:t.ambiguous?'检测到多个接入进程，请完整重启 Codex':(extensionStatus??extensionState()).message}:{}),modelMetadata:m?Object.fromEntries(['max_context_window','context_window','effective_context_window_percent','context_ceiling','context_compact_ceiling'].map(k=>[k,m[k]]).concat([['context_catalog_ready',ready]])):null};}
  function newChatDefaults(){return clampNewChatDefaults(store.data.newChatDefaults||(extension.enabled()?initialNewChatDefaults:nativeNewChatDefaults),defaultModel());}
  function selectedThread(id){if(typeof id==='string')store.refreshMetadata(false,[id]);if(typeof id!=='string'||!Object.hasOwn(store.data.threads,id))throw contextError('CHAT_NOT_FOUND','Chat not found.','select_chat');return publicThread(id,undefined,false);}
  function operationPeer(id){const peers=owners.get(id)||[];if(peers.length!==1)throw contextError('CONNECTION_REQUIRED','A unique connected runtime is required.','inspect_connection');if(bridges.get(peers[0])?.contextOperationsVersion!==1)throw contextError('RUNTIME_RESTART_REQUIRED','Restart Codex normally to load agent operation support.','restart_codex');return peers[0];}
  async function executeCompaction(operation){
    const current=operations.get(operation.id,operation.threadId);if(!['accepted','waiting_for_idle'].includes(current.state))return;
    const t=selectedThread(current.threadId);
    if((t.turnId??null)!==current.turnId||t.model!==current.model||(t.policy?.revision??0)!==current.revision||(t.contextEpoch??0)!==current.contextEpoch||(current.inputEpoch!=null&&(t.inputEpoch??0)!==current.inputEpoch)){operations.transition(current.id,t.id,{state:'superseded',reason:'chat_state_changed'});return;}
    if(t.status!=='idle'||(current.waitForTurnCompletion&&t.lastCompletedTurnId!==current.turnId))return;
    const peer=operationPeer(t.id);operations.transition(current.id,t.id,{state:'executing'});
    try{await peer.call('context-compact',{id:t.id,operationId:current.id,turnId:current.turnId,model:current.model,revision:current.revision,contextEpoch:current.contextEpoch,inputEpoch:current.inputEpoch},30000);}
    catch(error){operations.transition(current.id,t.id,{state:/changed|改变|轮次结束/.test(error.message)?'superseded':'outcome_unknown',reason:error.message});}
  }
  function observeOperations(id){
    const t=selectedThread(id);operations.observe(t);
    for(const operation of operations.pending(id))if(operation.kind==='compact'&&t.status==='idle')void executeCompaction(operation).catch(error=>operations.transition(operation.id,id,{state:'failed',reason:error.message}));
  }
  async function trackedPolicy(p){
    const t=selectedThread(p.id),policy=normalizeBudgetCommand(p,modelFor(p.id,t.model));
    const fingerprint=JSON.stringify({kind:'budget',policy,apply:p.apply!==false});
    const previous=operations.replay(p.id,p.requestId,fingerprint);if(previous)return {operation:previous,context:contextSnapshot(t)};
    if(p.expectedRevision!=null&&p.expectedRevision!==(t.policy?.revision??0))throw contextError('REVISION_CONFLICT','Budget changed; read this chat again.','refresh_chat');
    if(t.ephemeral||t.canAcceptDirectInput===false)throw contextError('UNSUPPORTED_CHAT','This chat does not accept budget operations.','select_chat');
    const plan=preflight(t,policy,modelFor(p.id,t.model));
    if(['above_catalog_maximum','above_safe_compact','below_retained_floor','unsupported_thread'].includes(plan.code))throw contextError('BUDGET_REJECTED',plan.message,'revise_budget');
    const operation=operations.create({threadId:p.id,requestId:p.requestId,fingerprint,kind:'budget',revision:(t.policy?.revision??0)+1});
    try{const result=await handle(null,'setPolicy',{...p,track:false});operations.transition(operation.id,p.id,{state:p.apply===false?'completed':'accepted'});observeOperations(p.id);return {...result,operation:operations.get(operation.id,p.id),context:contextSnapshot(selectedThread(p.id))};}
    catch(error){const saved=store.data.policies[p.id]?.revision===operation.revision;operations.transition(operation.id,p.id,{state:saved?'outcome_unknown':'failed',reason:error.message});throw Object.assign(error,{operationId:operation.id});}
  }
  async function trackedCompact(p){
    if(p.whenIdle!=null&&typeof p.whenIdle!=='boolean')throw contextError('INVALID_ARGUMENT','whenIdle must be boolean.','fix_request');
    const t=selectedThread(p.id),fingerprint=JSON.stringify({kind:'compact',whenIdle:p.whenIdle===true});
    const replay=operations.replay(p.id,p.requestId,fingerprint);if(replay)return {operation:replay,context:contextSnapshot(t)};
    operationPeer(p.id);
    if(t.ephemeral||t.canAcceptDirectInput===false)throw contextError('UNSUPPORTED_CHAT','This chat does not accept direct context operations.','select_chat');
    const waitForTurnCompletion=!!t.turnId&&t.lastCompletedTurnId!==t.turnId;
    if((t.status!=='idle'||waitForTurnCompletion)&&!p.whenIdle)throw contextError('WAITING_FOR_IDLE','Chat is active; use --when-idle after agreeing on compaction.','defer_until_idle');
    if(!['idle','active','inProgress'].includes(t.status))throw contextError('CHAT_NOT_READY','Chat is not ready for compaction.','refresh_chat');
    if(operations.pending(p.id).some(o=>o.kind==='compact'))throw contextError('OPERATION_PENDING','A compaction request is already pending.','inspect_operations');
    const operation=operations.create({threadId:p.id,requestId:p.requestId,fingerprint,kind:'compact',turnId:t.turnId??null,model:t.model,revision:t.policy?.revision??0,contextEpoch:t.contextEpoch??0,inputEpoch:t.inputEpoch??null,waitForTurnCompletion});
    operations.transition(operation.id,p.id,{state:t.status==='idle'&&!waitForTurnCompletion?'accepted':'waiting_for_idle'});
    if(t.status==='idle')await executeCompaction(operation);
    return {operation:operations.get(operation.id,p.id),context:contextSnapshot(selectedThread(p.id))};
  }
  function criticalThreadIds(){
    const ids=new Set();
    for(const [id,peers]of owners){const t=store.data.threads[id];if(peers.length&&t&&(['active','inProgress'].includes(t.status)||['reloading','compacting'].includes(t.phase)||['starting','running'].includes(t.automaticTask?.status)))ids.add(id);}
    for(const q of taskQueues.list().queues)if(q.enabled||q.tasks.some(t=>['waiting','running'].includes(t.status)))ids.add(q.id);
    for(const entry of taskQueues.schedules())if(['waiting_for_turn','waiting_context','waiting_quota','dispatching','running'].includes(entry.state))ids.add(entry.chatId);
    for(const id of operations.pendingThreadIds())ids.add(id);
    return [...ids];
  }
  function state({selectedIds=[]}={}){
    if(!Array.isArray(selectedIds)||selectedIds.length>20||selectedIds.some(id=>typeof id!=='string'||id.length>256))throw Error('Invalid selected chats');
    const requiredIds=[...criticalThreadIds(),...selectedIds];store.setRequiredIds(requiredIds);store.refreshMetadata(false,selectedIds);
    const fix=runtimeFix.status(undefined,[...bridges.values()]),ext=extensionState(fix);
    const ids=hotChatIds(Object.values(store.data.threads),{requiredIds,compare:compareThreadActivity});
    const threads=ids.map(id=>publicThread(id,ext,false)).sort(compareThreadActivity);
    // Keep background monitoring light: speed sampling is needed only while the tray menu is visible.
    try{if(JSON.parse(fs.readFileSync(path.join(root,'ui-status.json'),'utf8')).menuWindowVisible===true)responseSpeeds.observe(threads);}catch{}
    return {hotChats:{limit:HOT_CHAT_LIMIT,returned:threads.length},apiVersion:CONTROL_API_VERSION,capabilities:{agentContext:true,contextOperations:true,contextSchedules:true,reasoningBudget:true,visibleBudget:true,quotaAnalytics:true,creditBaseline:true,taskQueues:true,queueAccountSwitch:true,compactionCompensation:false},quotaActivation:quotaActivation.state(),taskQueues:taskQueueState(),queueModels:[...(store.catalog?.values()??[])].filter(m=>m.visibility!=='hidden').map(m=>({id:m.slug,name:m.display_name||m.slug,efforts:(m.supported_reasoning_levels??[]).map(e=>e.effort),defaultEffort:m.default_reasoning_level??null})),buildId,quota:accountQuotaState(),update:updater.status(),newChatDefaults:newChatDefaults(),newChatDefaultsLimits:newChatDefaultLimits(defaultModel()),newChatDefaultsPending:[...bridges.values()].some(b=>!b.newChatDefaultsVersion),version,bridgeCount:bridges.size,contextExtension:ext,compactionCompensation:compensation.status([...bridges.values()],threads),contextCeilingPending:ext.pending,runtimeFix:fix,bridges:[...bridges.values()].map(b=>({pid:b.pid,version:b.version??null,runtimeFixId:b.runtimeFixId??null})),threads,sidebar:store.projects.sidebar(threads)};
  }
  async function handle(peer,op,p) {
    if(op==='ping')return {ok:true,version,buildId};
    if(op==='state')return state(p);
    if(op==='newChatBudget'){const m=runtimeModel(null,p.model,p.contextCeiling??true);if(!m)throw Error('等待当前模型的原生窗口信息');return {policy:policyForNewChat(newChatDefaults(),m)};}
    if(op==='setNewChatDefaults'){
      const current=newChatDefaults();if(p.expectedRevision!=null&&p.expectedRevision!==current.revision)throw Error('全局默认已被修改，请重新打开设置后保存。');
      store.data.newChatDefaults={...normalizeNewChatDefaults(p,defaultModel()),revision:current.revision+1,updatedAt:Date.now()};if(!extension.enabled()&&store.data.extensionRestore)delete store.data.extensionRestore.defaults;store.save();return newChatDefaults();
    }
    if(op==='forkBudget'){if(typeof p.id==='string')store.refreshMetadata(false,[p.id]);const m=runtimeModel(p.id,p.model,p.contextCeiling);return {policy:policyForModel(store.data.policies[p.id],runtimeModel(p.id,null,p.contextCeiling)),model:m};}
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
    if(op==='registerBridge'){const first=bridges.size===0;const entry={ids:new Set(),pid:p.pid,reasoningBudgetVersion:p.reasoningBudgetVersion===1?1:null,contextScheduleVersion:p.contextScheduleVersion===1?1:null,contextOperationsVersion:p.contextOperationsVersion===1?1:null,creditsStopVersion:p.creditsStopVersion===1?1:null,nativePid:Number.isSafeInteger(p.nativePid)&&p.nativePid>0?p.nativePid:null,accountSwitchVersion:p.accountSwitchVersion===1?1:null,compensationVersion:[1,2,3].includes(p.compensationVersion)?p.compensationVersion:null,taskQueueVersion:p.taskQueueVersion==null?null:p.taskQueueVersion===4?4:0,version:typeof p.version==='string'?p.version:null,runtimeFixId:typeof p.runtimeFixId==='string'?p.runtimeFixId:null,contextCeiling:p.contextCeiling===CONTEXT_CEILING_VERSION?CONTEXT_CEILING_VERSION:null,contextCatalogRevision:p.contextCatalogRevision===2?2:null,newChatDefaultsVersion:[1,2].includes(p.newChatDefaultsVersion)?p.newChatDefaultsVersion:null};bridges.set(peer,entry);if(first)ensureMenuBarEntry();peer.socket.on('close',()=>{bridges.delete(peer);rebuildOwners();for(const id of entry.ids){if(!owners.has(id)&&store.data.threads[id])Object.assign(store.data.threads[id],{freshUsage:false,usageFresh:false,phase:'disconnected',message:'连接已断开；显示的是上次观测值。'});for(const o of operations.pending(id))if(o.kind==='compact')operations.transition(o.id,id,{state:o.state==='waiting_for_idle'?'cancelled':'outcome_unknown',reason:'connection_closed'});taskQueues.cancelSchedules(id,'connection_closed');}store.save();});return {ok:true};}
    if(op==='updateContextOperation'){
      if(!bridges.get(peer)?.ids.has(p.id))throw contextError('AUTH_FAILED','This runtime does not own the chat.');
      const operation=operations.get(p.operationId,p.id);if(operation.kind!=='compact'||operation.state!=='executing')return {ignored:true};
      if(!['completed','failed','outcome_unknown'].includes(p.state))throw contextError('INVALID_ARGUMENT','Invalid completion state.');
      return operations.transition(operation.id,p.id,{state:p.state,reason:typeof p.reason==='string'?p.reason.slice(0,500):null});
    }
    if(op==='observeQuota'){if(!bridges.has(peer))throw Error('未注册运行时连接');if(!accountTransition&&!queueAccountAuto?.state().busy){if(p.invalidated===true){passiveQuota.invalidate();quota.invalidate();}else if(passiveQuota.observe(p)){bridges.get(peer).quotaObservedAt=p.observedAt;await quota.sync();}}return {ok:true};}
    if(op==='localUsage'){if(!bridges.get(peer)?.ids.has(p.id))throw Error('此连接尚未加载聊天');return contextStatistics.observation(p.id);}
    if(op==='updateThread') {
      const b=bridges.get(peer);if(!b)throw new Error('未注册运行时连接');
      if(typeof p.id!=='string'||p.id.length>180||['__proto__','constructor','prototype'].includes(p.id))throw new Error('聊天 ID 无效');
      const previousPolicy=JSON.stringify(store.data.policies[p.id]??null);
      const hadOwner=b.ids.has(p.id);
      b.ids.add(p.id);rebuildOwners();
      const allowed=['id','name','cwd','model','effort','status','ephemeral','canAcceptDirectInput','observedWindow','expectedWindow','configuredWindow','lastUsage','freshUsage','usageFresh','phase','message','turnId','revision','observedAt','forkedFromId','threadSource','automaticTask','compensation','appliedBudget','lastTurnStatus','contextEpoch','lastCompletedTurnId','inputEpoch'];
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
      store.refreshMetadata(false,[p.id]);const inherited=store.inheritDiscoveredForks();
      if(!Object.hasOwn(store.data.policies,p.id)&&p.newChatPolicy&&b.newChatDefaultsVersion!=null&&!p.ephemeral&&p.canAcceptDirectInput!==false&&!store.data.threads[p.id].forkedFromId){store.data.policies[p.id]={...persistedNewChatPolicy(p.newChatPolicy,runtimeModel(p.id,clean.model,b.contextCeiling===CONTEXT_CEILING_VERSION)),updatedAt:Date.now()};}
      Object.assign(store.data.threads[p.id],reconcileWindowConfirmation(store.data.threads[p.id],store.data.policies[p.id],modelFor(p.id)));
      if(inherited||previousPolicy!==JSON.stringify(store.data.policies[p.id]??null))store.save();else store.scheduleSave();
      // Completion still reconciles when monitoring was switched off mid-turn.
      taskQueues.observeThread(selectedThread(p.id));
      observeOperations(p.id);
      void taskQueues.tick();
      return {policy:bridgeReady(b)?store.data.policies[p.id]||null:null,model:runtimeModel(p.id,clean.model,b.contextCeiling===CONTEXT_CEILING_VERSION)};
    }
    if(op==='preflight') {
      if((owners.get(p.id)||[]).some(peer=>!bridgeReady(bridges.get(peer))))return {code:'runtime_restart_required',allowed:false,message:'请完整退出并重开 Codex，加载修正后的模型目录。',budgetValid:null,evidence:{sufficient:false},execution:{canExecuteNow:false,when:'blocked',blockers:['runtime_restart_required']},registered:false};
      let t=selectedThread(p.id);const policy=normalizeBudgetCommand(p,modelFor(p.id,t.model));
      if(t.status==='idle'&&!(t.usageFresh??t.freshUsage)&&preflight(t,policy,modelFor(p.id,t.model)).code==='needs_observation'){
        const stamp=JSON.stringify([t.turnId,t.model,t.observedAt,t.policy?.revision]);
        const local=await contextStatistics.observation(p.id).catch(()=>null);const current=selectedThread(p.id);
        if(local?.known&&local.model===t.model&&stamp===JSON.stringify([current.turnId,current.model,current.observedAt,current.policy?.revision]))t={...t,lastUsage:local.lastUsage,usageFresh:true};else t=current;
      }
      return {...contextPreflight(t,policy,modelFor(p.id,t.model)),context:contextSnapshot(t)};
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
      store.save();operations.observe(publicThread(p.id));
      if(saved.enabled&&candidates.length===1){await candidates[0].call('setPolicy',{id:p.id,policy:saved,model:modelFor(t.id,t.model)});}
      return {policy:saved,plan,thread:publicThread(p.id)};
    }
    if(op==='clearPolicy'){
      if(!Object.hasOwn(store.data.threads,p.id))throw new Error('未找到聊天');
      if(!extension.enabled()&&store.data.extensionRestore?.policies)delete store.data.extensionRestore.policies[p.id];
      const previous=store.data.policies[p.id];if(previous)store.data.policies[p.id]={...previous,enabled:false,revision:previous.revision+1};store.save();operations.observe(publicThread(p.id));
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
      if(operation==='state'||operation==='hot-state')answer=state(params);
      else if(operation==='chat-list')answer=store.listLocal(params.offset??0);
      else if(operation==='chat'){
        const thread=selectedThread(params.id),capabilities={agentContext:true,contextOperations:true,reasoningBudget:(owners.get(params.id)||[]).length===1&&bridges.get(owners.get(params.id)[0])?.reasoningBudgetVersion===1,scheduleAfterTurn:(owners.get(params.id)||[]).length===1&&bridges.get(owners.get(params.id)[0])?.contextScheduleVersion===1,compactWhenIdle:(owners.get(params.id)||[]).length===1&&bridges.get(owners.get(params.id)[0])?.contextOperationsVersion===1};
        answer=params.summary===true?{...contextSnapshot(thread,{deferredCompaction:capabilities.compactWhenIdle,operations:operations.list(params.id),schedules:taskQueues.schedules().filter(s=>s.chatId===params.id)}),capabilities}:{...thread,agentCapabilities:capabilities};
      }
      else if(operation==='context-schedule'){
        const thread=selectedThread(params.id);
        if(params.action==='list')answer={schedules:taskQueues.schedules().filter(s=>s.chatId===params.id)};
        else if(params.action==='cancel')answer={schedule:taskQueues.cancelSchedule(params.id,params.scheduleId)};
        else if(params.action==null||params.action==='schedule'){
          if(codexRestore.active||accountTransition||queueAccountAuto.state().busy)throw contextError('SERVICE_BUSY','Wait for restore or account transition to finish.','wait');
          const peers=owners.get(params.id)||[];if(peers.length!==1||bridges.get(peers[0])?.contextScheduleVersion!==1)throw contextError('RUNTIME_RESTART_REQUIRED','Restart Codex normally to load scheduled handoff support.','restart_codex');
          const schedule=taskQueues.schedule(params),quotaGate=taskQueues.scheduleQuotaGate(params.id);
          answer={schedule,nextAction:schedule.state==='waiting_for_turn'?'finish_turn':'inspect_schedule',agentInstruction:schedule.state==='waiting_for_turn'?'请保存交接进展并结束当前轮次，等待下一条消息。不要调用等待工具占住本轮；App 会在本轮完成且条件满足后发送一次恢复消息。真实用户消息会取消尚未启动的自动恢复。':'请检查现有交接回执；不要重复登记或假定需要再次暂停。',context:contextSnapshot(thread),readiness:{requires:['source_turn_completed','context_ready','fresh_quota','unchanged_intent'],quotaValid:quotaGate.valid,quotaBlocked:quotaGate.blocked,quotaSource:quotaGate.source,quotaReason:quotaGate.reason??null},note:'Registration does not change the active window or end this turn. Finish at a checkpoint; the existing scheduler will start at most one continuation.'};
        }else throw contextError('INVALID_ARGUMENT','Expected schedule, list or cancel.','fix_request');
      }
      else if(operation==='context-operation'){
        selectedThread(params.id);
        if(params.action==='list')answer={operations:operations.list(params.id)};
        else if(params.action==='show')answer={operation:operations.get(params.operationId,params.id)};
        else if(params.action==='cancel')answer={operation:operations.cancel(params.operationId,params.id)};
        else throw contextError('INVALID_ARGUMENT','Expected list, show or cancel.','fix_request');
      }
      else if(operation==='speed-report'){
        selectedThread(params.id);const limit=params.limit??20;if(!Number.isInteger(limit)||limit<1||limit>200)throw contextError('INVALID_ARGUMENT','Limit must be 1–200.','fix_request');
        const report=speedReport(params.id,await contextStatistics.speedReport(params.id,params.refresh===true),limit);answer=params.summary===true?{id:report.id,metric:report.metric,comparison:report.comparison,groups:report.groups,notes:report.notes}:report;
      }
      else if(codexRestore.active&&['account-switch','install-update','task-queue','quota-activation'].includes(operation)&&params.action!=='status')throw Error('请先完成或取消 Codex 恢复');
      else if(operation==='account-switch'){if(queueAccountAuto.state().busy&&params.action!=='status')throw Error('自动切换正在进行，请稍后重试');if(params.action==='preflight')answer={blockers:switchBlockers()};else{const result=await accountSwitcher.command(params);if(params.action==='switch'){passiveQuota.invalidate();quota.invalidate();queueAccountAuto.retarget(params.id);}answer=accountQuotaViews(result,accountQuotaState()).login;}}
      else if((accountTransition||queueAccountAuto.state().busy)&&['cloud-sync','quota-activation','task-queue','quota-refresh','quota-credit-baseline'].includes(operation)&&!(operation==='task-queue'&&(params.enabled===false&&['monitoring','enable','account-switch'].includes(params.action)||['stop','disable-all'].includes(params.action))))throw Error('账号切换正在进行，请稍后重试');
      else if(operation==='codex-backups'){if(accountTransition||queueAccountAuto.state().busy)throw Error('请等待账号切换完成');if(powerProtection.busy&&params.action!=='list')throw Error('正在备份，请稍后重试');if(params.action==='capture'){if(codexRestore.active)throw Error('请先完成或取消恢复');const result=await powerProtection.tick();if(result?.errors?.length)throw Error(result.errors[0].error||'备份失败');answer=codexRestore.list();}else answer=await codexRestore.command(params);}
      else if(operation==='cloud-sync')answer=await cloudSync.command(params);
      else if(operation==='task-queue'){if(params.action==='account-switch'){queueAccountAuto.configure(params.enabled);}else{if(params.action==='enable'&&params.enabled&&typeof params.id==='string'&&Object.hasOwn(store.data.threads,params.id)&&!(owners.get(params.id)||[]).length&&queueSupported(params.id))await queueCall(params.id,'queue-prepare',{});taskQueues.command(params);}answer=taskQueueState();}
      else if(operation==='quota-activation'){answer=quotaActivation.command(params);void quotaActivation.tick().catch(()=>{});}
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
      else if(operation==='policy')answer=params.track===true?await trackedPolicy(params):await handle(null,'setPolicy',params);
      else if(operation==='clear')answer=await handle(null,'clearPolicy',params);
      else if(operation==='compact')answer=params.track===true?await trackedCompact(params):await handle(null,'compact',params);
      else{res.writeHead(404);res.end();return;}
      let serialized;
      if(route==='/context-stats'){
        serialized=statisticsJSON.get(answer);if(serialized==null){serialized=JSON.stringify(answer);statisticsJSON.set(answer,serialized);}
      }else serialized=JSON.stringify(answer);
      res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(serialized);
    }catch(error){res.writeHead(400,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error:error.message,...(error.code?{code:error.code}:{}),...(error.nextAction?{nextAction:error.nextAction}:{}),...(error.operationId?{operationId:error.operationId}:{})}));}
  });
  await new Promise((resolve,reject)=>{web.once('error',reject);web.listen(0,'127.0.0.1',resolve);});
  atomicJSON(path.join(root,'connection.json'),{port:web.address().port,token,pid:process.pid,script:fileURLToPath(import.meta.url),executable:process.execPath,buildId});
  const cleanup=()=>{try{cleanupOldRuntimes();}catch{}};
  const cleanupStart=setTimeout(cleanup,30000);cleanupStart.unref();
  const cleanupTimer=setInterval(cleanup,5*60*1000);cleanupTimer.unref();
  const scanTimer=setInterval(()=>{store.setRequiredIds(criticalThreadIds());store.refreshMetadata();},15000);scanTimer.unref();
  web.once('close',()=>{clearInterval(creditsTimer);queueAccountAuto.close();clearInterval(accountAutoTimer);accountSwitcher.close();clearInterval(activationTimer);quotaActivation.close();cloudSync.close();clearTimeout(analyticsTimer);quotaAnalytics.close();taskQueues.close();});
  const shutdown=()=>{responseSpeeds.close();contextStatistics.close();try{store.flush();}catch{}for(const p of bridges.keys())p.socket.destroy();ipcServer.close();web.close();try{prepareEndpoint(socketPath);}catch{}try{fs.unlinkSync(path.join(root,'connection.json'));}catch{};process.exit(0);};
  process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
  return {ipcServer,web,store};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){ensureRoot();process.chdir(root);startDaemon().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});}
