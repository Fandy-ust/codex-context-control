import {nextActivationAt} from '../../src/core/activation-schedule.mjs';
import {movedQueueOrder} from '../../src/core/queue-order.mjs';
import {accountSwitchView,switchSavedAccount} from './account-switch.mjs';
import {cloudSyncView,cloudSyncForm} from './cloud-sync.mjs';
import {responseSpeedContent} from './response-speed.mjs';
import {activationView} from './quota-activation.mjs';
import {normalizeTaskSettings} from '../../src/core/task-settings.mjs';
import {queueStrip,queueManager,queueDetail,queueTaskEditor} from './task-queues.mjs';
import {quotaAnalyticsView,bindQuotaAnalytics} from './quota-analytics.mjs';
import {observeCreditBalance} from '../../src/credit-baseline.mjs';
import {draftLimits as legacyDraftLimits,resizeDraft as legacyResizeDraft,policyForDraft as legacyPolicyForDraft} from '../../src/core/default-budget-editor.mjs';
import {threadDraft as appleThreadDraft,threadDraftLimits as appleDraftLimits,resizeThreadDraft as appleResizeDraft,policyForThreadDraft as applePolicyForDraft} from '../../src/core/budget-editor.mjs';
import {observedWindowTitle,modelDisplayName,displayedContextWindow} from '../../src/presentation/chat.mjs';
import {budgetCommand} from '../../src/core/budget-command.mjs';
import {tokenNumber} from '../../src/policy.mjs';
import {timelineData,nearestBucket} from '../../src/timeline-data.mjs';
import {translate} from '../../src/localization-core.mjs';
import {trayState} from '../../src/tray-state.mjs';
import {timelinePlot,timelineX,timelinePosition} from '../../src/timeline-scale.mjs';
import {DEFAULT_SHORTCUT,shortcutLabel,shortcutFromEvent,normalizeShortcut} from '../../src/ui-shortcut.mjs';
import {sliderMotion,SLIDER_MOTION_SECONDS} from '../../src/slider-motion.mjs';
import {selectedQuota,quotaWindows,quotaStale,quotaLevel,quotaCountdown} from '../../src/quota-display.mjs';
import {projectSidebar} from './project-sidebar.mjs';
import {scrollActivity} from './scroll-activity.mjs';
import {installScrollEdges} from './scroll-edges.mjs';
import {timelineEvents} from './timeline-events.mjs';
import {sidebarAccounts,sidebarCredits,sidebarQuota,quotaPeriod,quotaReset,resizeQuotaOutline} from './sidebar-quota.mjs';
import {budgetView,chatView,detailsView,statisticsView,chartDetailView,chartTooltipView,rawRecordsView,trayChatView} from './apple-view.mjs';

const api=window.contextManager,root=document.querySelector('#app'),mode=new URLSearchParams(location.search).get('mode')||'main';
const scrollEdges=installScrollEdges(root);
let state=null,preferences={language:'zh',selection:'auto',english:{}},selected=null,view='chat',draft=null,dirty=false,dragging=false,busy=false,stats=null,statsJSON='',timeline=null,period=0,hover=null,pinned=null,page=0,auto=true,lastStats=0,toastTimer,refreshing=false,interactionId=null;
let shortcutDraft=DEFAULT_SHORTCUT,shortcutEnabled=true,shortcutRecording=false,shortcutDirty=false;
let queueDrag=null;
let queueID=null,queueReturnSettings=false,queueTaskDraft=null,queueTaskTab='prompt',queueExpanded=false,queueModelOpen=false;
const queueFormDrafts=new Map(),queuePreviews=new Map();
let cloudState=null,loginState=null,loginRendered="";
let activationDraft=null;
let settingsOpen=false,settingsTab='general',settingsSnapshot=null,settingsUnderlay='';
let integrationError='',integrationPending=false;
let detailsOpen=false,detailsRestoreScroll=null,statsLoading=false,statsError='',rawSelectedID=null,lastDetailBucket=null,smoothingTimer,deferredStats=null;
let mainNotice='',mainNoticeError=false;
let budgetInputError='',detailsEpoch=0,serviceAvailable=false,smoothingInteracting=false;
let budgetText={};
let chartPointer=null,chartTooltipBucket=null;
let cancelChartPointer=()=>{},scrollRenderPending=false;
const mainScroll=scrollActivity({
  onStart(){cancelChartPointer();hover=null;hideChartTooltip();updateChartSelection();},
  onIdle(){const repaint=scrollRenderPending;scrollRenderPending=false;applyDeferredStats();if(repaint)render();}
});
const trayFeedback=new Map(),traySaving=new Set();
const editingDefaults=()=>settingsOpen?settingsTab==='defaults':view==='defaults';
const useLegacyBudget=()=>editingDefaults();
const modelSignature=chat=>JSON.stringify([chat?.model,chat?.modelMetadata?.max_context_window,chat?.modelMetadata?.effective_context_window_percent,chat?.modelMetadata?.context_ceiling,chat?.modelMetadata?.context_catalog_ready]);
const threadDraft=chat=>{const value=appleThreadDraft(chat);return mode==='tray'&&value?{...value,baseWindow:value.window,baseCompact:value.compact,baseEnabled:!!chat.policy&&chat.policy.enabled!==false,modelKey:modelSignature(chat)}:value;};
const draftLimits=(...args)=>(useLegacyBudget()?legacyDraftLimits:appleDraftLimits)(...args);
const resizeDraft=(...args)=>(useLegacyBudget()?legacyResizeDraft:appleResizeDraft)(...args);
const policyForDraft=(...args)=>(useLegacyBudget()?legacyPolicyForDraft:applePolicyForDraft)(...args);
const editorRoot=()=>settingsOpen?root.querySelector('.settings-body'):root.querySelector('.main');
const chatName=chat=>chat?.name||chat?.title||chat?.cwd?.split(/[\\/]/).filter(Boolean).at(-1)||chat?.id?.slice(0,12)||t('未命名聊天','Untitled chat');
let qaOutlookStart='',qaOutlookEnd='',qaOutlookRange=null;
let qaReport=null,qaLoading=false,qaError='',qaSection='overview',qaPeriod='',qaOutlookMetric='cost',qaOutlookOverlay=true,qaOutlookOverlayCount=6,qaOutlookSmoothing=0,qaForecastOverlay=false,qaCostPeriod='year',qaCostMode='heatmap',qaAnalysisMode='simple',qaCostDate='',qaCostStart='',qaCostEnd='',qaCostRange=null,qaDays=28,qaScope='',qaPool='',qaModel='',qaEpoch=0,qaLastLoad=0;
let creditMigrationAttempted=false;
let creditBaselines={};
try{const saved=JSON.parse(localStorage.getItem('credit-baselines')||'{}');if(saved&&typeof saved==='object'&&!Array.isArray(saved))creditBaselines=saved;}catch{}
function observeCredits(quota){
  if(quota?.creditBaselines){
    if(!creditMigrationAttempted&&quota.updatedAt&&!quota.stale){creditMigrationAttempted=true;try{const legacy=JSON.parse(localStorage.getItem('credit-baselines')||'{}');for(const bucket of quota.buckets||[]){const value=legacy[bucket.id];if(value&&Number(bucket.creditBalance)===value.last)void api.invoke('quota-credit-baseline',{id:bucket.id,legacy:value}).then(next=>{creditBaselines=next.creditBaselines;if(state)state.quota=next;if(mode==='main')render();}).catch(()=>{});}}catch{}}
    creditBaselines=quota.creditBaselines;return;
  }
  if(mode!=='main'||quota?.stale!==false||quota.loading)return;
  let changed=false;
  for(const bucket of quota.buckets||[]){
    if(bucket.unlimitedCredits)continue;
    const previous=creditBaselines[bucket.id],next=observeCreditBalance(previous,bucket.creditBalance);
    if(next&&JSON.stringify(previous)!==JSON.stringify(next)){Object.defineProperty(creditBaselines,bucket.id,{value:next,writable:true,enumerable:true,configurable:true});changed=true;}
  }
  if(changed)try{localStorage.setItem('credit-baselines',JSON.stringify(creditBaselines));}catch{}
}
const trayDrafts=new Map();
const projectExpansion=new Map(),sidebarScroll=new Map(),detailsScrollByChat=new Map();
let recentExpanded=localStorage.getItem('recent-expanded')!=='false';
try{const saved=JSON.parse(localStorage.getItem('project-expansion')||'[]');if(Array.isArray(saved))for(const pair of saved)if(Array.isArray(pair)&&typeof pair[0]==='string'&&typeof pair[1]==='boolean')projectExpansion.set(...pair);}catch{}
root.addEventListener('scroll',event=>{const key=event.target.dataset?.sidebarScroll;if(key)sidebarScroll.set(key,event.target.scrollTop);},true);
let sidebarWidth=Number(localStorage.getItem('sidebar-width'))||340;
const visibleSidebarWidth=()=>Math.max(310,Math.min(sidebarWidth,380,window.innerWidth-650));
const e=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
function t(zh,en,...args){const translated=translate(zh,preferences.english,preferences.language);let value=preferences.language==='zh'?zh:translated===zh?(en||zh):translated;return String(value??'').replace(/\{(\d+)\}/g,(_,n)=>String(args[n]??''));}
const amount=value=>value==null?'—':Number(value).toLocaleString(preferences.language==='zh'?'zh-CN':'en-US',{maximumFractionDigits:1});
const k=value=>value==null?'—':value>=1000000?(value/1000000).toFixed(2).replace(/\.?0+$/,'')+'M':value>=1000?Number((value/1000).toFixed(1))+'K':amount(value);
const money=value=>value==null?'—':'$'+Number(value).toFixed(2);
const tokens=value=>value==null?t('待观测','Unobserved'):amount(value)+' tokens';
const current=()=>state?.threads.find(t=>t.id===selected);
const phaseNames={connection_conflict:['接入进程冲突','Connection conflict'],extension_pending:['等待重开 Codex','Restart Codex'],compacting:['正在保护性压缩','Compacting'],confirmed:['窗口已确认','Window confirmed'],awaiting_runtime_confirmation:['等待下一轮确认','Awaiting next-turn confirmation'],reloading:['正在应用','Applying'],waiting_for_idle:['等待轮次结束','Waiting for turn end'],queued:['等待轮次结束','Queued'],needs_compaction:['需要先压缩','Compaction needed'],needs_observation:['等待用量记录','Waiting for usage'],error:['需要处理','Needs attention'],mismatch:['需要处理','Readback mismatch'],saved:['已保存','Saved']};
const phase=thread=>{const names=phaseNames[thread?.phase];return names?t(...names):t('尚未接入','Not connected');};
function notify(message){const node=document.querySelector('#toast');node.textContent=t(message);node.style.display='block';clearTimeout(toastTimer);toastTimer=setTimeout(()=>node.style.display='none',6500);}
async function run(action,params={},message){if(busy)return;busy=true;document.body.classList.add('busy');try{const result=await api.invoke(action,params);if(message)notify(message);return result;}catch(error){notify(error.message);throw error;}finally{busy=false;document.body.classList.remove('busy');}}
function observed(thread){const capacity=displayedContextWindow(thread);return capacity>0&&thread.lastUsage?.totalTokens!=null?Math.max(0,thread.lastUsage.totalTokens/capacity):null;}
function ring(thread){const fraction=observed(thread);return `<span class="ring" style="--fraction:${Math.min(1,fraction??0)}" aria-hidden="true"><i></i></span>`;}
function statusText(thread){return thread.connected?phase(thread):t(thread.lastUsage?'已缓存':'本地聊天',thread.lastUsage?'Cached':'Local chat');}
function sidebar(){
  const connected=state?.bridgeCount>0;
  const update=state?.update,updating=['downloading','installing'].includes(update?.phase);
  const updateButton=update?.available||updating?`<button class="quick-update" data-action="update" ${updating||busy?'disabled':''} title="${e(update.error||t('安装更新 {0}','Install update {0}',update.version||''))}">${updating?'↻':'↓'} ${e(updating?t('更新中','Updating'):t('有更新','Update'))}</button>`:'';
  const navigation=projectSidebar({threads:state?.threads,sidebar:state?.sidebar,selected,expanded:projectExpansion,recentExpanded,t,escape:e,chatName,statusText});
  return `<aside class="sidebar"><div class="brand row"><span class="dot ${connected?'on':''}"></span><span>Codex</span>${preferences.demo?`<span class="preview-pill">${e(t('预览','Preview'))}</span>`:''}<span class="grow"></span><span class="tiny">v${e(preferences.version||'')}</span>${updateButton}<button class="settings-trigger" data-action="settings" title="${e(t('设置','Settings'))}" aria-label="${e(t('设置','Settings'))}" aria-haspopup="dialog" aria-expanded="${settingsOpen}"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m9.5 3-.7 2.2-2 .9-2.1-.5-2.5 4.3 1.5 1.7v2.3l-1.5 1.7 2.5 4.3 2.1-.5 2 .9.7 2.2h5l.7-2.2 2-.9 2.1.5 2.5-4.3-1.5-1.7v-2.3l1.5-1.7-2.5-4.3-2.1.5-2-.9-.7-2.2Z"/><circle cx="12" cy="12.8" r="3"/></svg></button></div>${navigation}${sidebarAccounts({quota:state?.quota,pool:preferences.quotaPool,observation:creditBaselines[selectedQuota(state?.quota,preferences.quotaPool)?.id],available:serviceAvailable,t,escape:e,language:preferences.language})}</aside>`;
}
function slider(value,model,{single=false,id='main'}={}){
  const limit=draftLimits(model,value.window,value.reserve),max=limit?.maximum||1,white=value.window/max*100,blue=value.compact/max*100;
  const maxMode=model.context_ceiling===920000&&value.window===920000;
  return `<div class="slider" data-slider="${e(id)}" data-single="${single}" data-motion-rate="${sliderMotion(value,max).rate}" style="--motion-duration:${SLIDER_MOTION_SECONDS}s"><div class="track"><div class="fill ${maxMode?'max-flow':''}" style="width:${single?white:blue}%"></div>${single?'':`<div class="headroom-fill" style="left:${blue}%;width:${Math.max(0,white-blue)}%"></div>`}<span class="particles">${single?'':particleMarkup(value,max)}</span></div>${single?'':`<i class="thumb compact ${interactionId==='compact'?'selected':''}" style="left:${blue}%"></i>`}<i class="thumb ${interactionId!=='compact'?'selected':''}" style="left:${white}%"></i>${single?'':`<input class="a11y-range" data-range="compact" aria-label="${e(t('压缩触发','Compression trigger'))}" aria-valuetext="${k(value.compact)}" type="range" min="1000" max="${Math.max(1000,limit.compact)}" step="1000" value="${value.compact}">`}<input class="a11y-range" data-range="window" aria-label="${e(t('上下文窗口','Context window'))}" aria-valuetext="${k(value.window)}" type="range" min="${single?2000:1000}" max="${max}" step="1000" value="${value.window}"><span class="keyboard-focus">${e(t('使用左右方向键调节','Use arrow keys to adjust'))}</span></div>`;
}
// Keep random profiles and a focus-aware clock across automatic DOM refreshes.
// CSS animates every frame; JS only sets up particles when controls change.
const particleProfiles=[],motionTimelines=new Map(),initializedMotion=new WeakSet();
const particleClock={elapsed:0,at:performance.now(),running:!document.hidden&&document.hasFocus()};
function particleTime(){return particleClock.elapsed+(particleClock.running?performance.now()-particleClock.at:0);}
function particleStyle(index){
  const p=particleProfiles[index]??=({phase:Math.random(),pace:.85+Math.random()*.6,top:4+Math.random()*15,size:1.7+Math.random()*1.4,opacity:.3+Math.random()*.5,sway:5+Math.random()*9,driftA:-3+Math.random()*6,driftB:-3+Math.random()*6});
  const duration=SLIDER_MOTION_SECONDS*p.pace;
  return `--particle-duration:${duration.toFixed(3)}s;--particle-delay:-${(p.phase*duration).toFixed(3)}s;--drift-duration:${p.sway.toFixed(3)}s;--drift-delay:-${(p.phase*p.sway).toFixed(3)}s;--particle-opacity:${p.opacity.toFixed(3)};--drift-a:${p.driftA.toFixed(2)}px;--drift-b:${p.driftB.toFixed(2)}px;top:${p.top.toFixed(2)}px;width:${p.size.toFixed(2)}px;height:${p.size.toFixed(2)}px`;
}
function syncParticleTime(slider){
  const now=particleTime(),rate=Number(slider.dataset.motionRate)||1,key=slider.dataset.slider;
  let clock=motionTimelines.get(key);
  if(!clock){clock={at:now,time:now*rate,rate};motionTimelines.set(key,clock);}
  else{clock.time+=(now-clock.at)*clock.rate;clock.at=now;clock.rate=rate;}
  // Read the animation list once after all DOM writes, rather than flushing
  // styles for every particle. Change playback rate without seeking its phase.
  for(const animation of slider.getAnimations({subtree:true})){
    const drifting=animation.animationName==='particle-drift';
    if(!drifting&&!['particle','max-flow'].includes(animation.animationName))continue;
    if(!initializedMotion.has(animation)){animation.currentTime=drifting?now:clock.time;initializedMotion.add(animation);}
    const nextRate=drifting?1:rate;
    if(animation.playbackRate!==nextRate)animation.updatePlaybackRate(nextRate);
  }
}
function particleMarkup(value,maximum){
  const motion=sliderMotion(value,maximum);
  return Array.from({length:motion.count},(_,i)=>`<i style="${particleStyle(i)}"></i>`).join('');
}
function updateParticles(slider,value,maximum){
  const motion=sliderMotion(value,maximum);slider.dataset.motionRate=String(motion.rate);
  const particles=slider.querySelector('.particles');if(!particles||slider.dataset.single==='true'){syncParticleTime(slider);return;}
  while(particles.children.length<motion.count){const particle=document.createElement('i');particle.style.cssText=particleStyle(particles.children.length);particles.append(particle);}
  while(particles.children.length>motion.count)particles.lastElementChild.remove();
  syncParticleTime(slider);
}
function budgetCard(value,model,options={}){
  if(options.defaults)return settingsBudgetCard(value,model,options);
  return budgetView({value,model,limit:value?draftLimits(model,value.window,value.reserve):null,slider,selection:interactionId||'window',budgetText,e,t,k,amount});
}
function settingsBudgetCard(value,model,{defaults=false}={}){
  if(!value||!model)return `<div class="state-card muted">${e(t('等待当前模型的原生窗口信息','Waiting for model window metadata'))}</div>`;
  const limit=draftLimits(model,value.window,value.reserve),maxMode=model.context_ceiling===920000&&value.window===920000;
  return `<div class="card draft-card"><div class="range-values"><button class="range-value compact ${interactionId==='compact'?'selected':''}" data-action="target" data-target="compact"><strong class="num" id="compact-value">${e(k(value.compact))}</strong><span>${e(t('压缩触发','Compression trigger'))}</span></button><div class="headroom"><strong class="num" id="headroom-value">${e(k(Math.max(0,value.window-value.compact)))}</strong><div class="tiny muted">${e(t('压缩窗口余量','Compression headroom'))}</div></div><button class="range-value ${interactionId!=='compact'?'selected':''}" data-action="target" data-target="window"><strong class="num" id="window-value">${e(k(value.window))}</strong><span>${e(t('上下文窗口','Context window'))}</span></button><button class="flat" data-action="reload" title="${e(t('重新载入已保存预算','Reload saved budget'))}" aria-label="${e(t('重新载入已保存预算','Reload saved budget'))}">↶</button></div>${slider(value,model)}<div class="scale"><span>0</span><span id="max-label">${maxMode?'MAX CONTEXT · ':''}${e(k(limit.maximum))}</span></div><div class="adjust row between"><div class="adjust-group"><span class="tiny muted">${e(t('压缩','Compression'))}</span><button data-action="step" data-target="compact" data-step="-1000" aria-label="${e(t('压缩减少 1K','Decrease compression by 1K'))}">−</button><button data-action="step" data-target="compact" data-step="1000" aria-label="${e(t('压缩增加 1K','Increase compression by 1K'))}">+</button></div><div class="adjust-group"><span class="tiny muted">${e(t('窗口','Window'))}</span><button data-action="step" data-target="window" data-step="-1000" aria-label="${e(t('窗口减少 1K','Decrease window by 1K'))}">−</button><button data-action="step" data-target="window" data-step="1000" aria-label="${e(t('窗口增加 1K','Increase window by 1K'))}">+</button></div></div><div class="row wrap">${[200000,400000,700000].filter(n=>n<=limit.maximum).map(n=>`<button class="pill ${value.window===n?'active':''}" data-action="preset-window" data-value="${n}">${k(n)}</button>`).join('')}<button class="pill ${value.window===limit.maximum?'active':''}" data-action="preset-window" data-value="${limit.maximum}">MAX</button><span class="grow"></span>${[80,85,90].map(n=>`<button class="pill" data-action="preset-ratio" data-value="${n}">${n}%</button>`).join('')}</div>${defaults?'':`<details class="advanced"><summary>${e(t('高级设置','Advanced settings'))}</summary><div class="advanced-content"><label class="tiny muted">${e(t('下一轮预留','Next-turn reserve'))}<input type="number" id="reserve" min="0" step="1000" value="${value.reserve}"></label><label class="tiny muted">${e(t('手动保留下限','Retained floor'))}<input type="number" id="retained" min="0" step="1000" value="${value.retainedFloor}"></label></div><p class="tiny muted">${e(t('底层窗口','Raw window'))}: <span id="raw-window">${amount(Math.ceil(value.window*100/model.effective_context_window_percent))}</span> · ${e(t('可用比例','Effective percentage'))}: ${model.effective_context_window_percent}%</p></details>`}</div>`;
}
function chatPage(){
  const chat=current();let previewError=budgetInputError;
  if(chat&&!previewError){try{if(!draft)throw Error('等待当前模型的原生窗口信息');applePolicyForDraft(draft,chat.modelMetadata,chat);}catch(error){previewError=error.message;}}
  return chatView({chat:chat?{...chat,name:chatName(chat)}:null,draft,observedTitle:observedWindowTitle(chat),modelName:modelDisplayName(chat?.model||''),canEdit:!!draft&&chat?.modelMetadata?.context_catalog_ready!==false,previewError,budgetCard,details:queueStrip({quota:state?.quota,chat,queues:state?.taskQueues,e,t})+detailsPage(),notice:mainNotice,noticeError:mainNoticeError,e,t,tokens});
}

function defaultModel(){const l=state?.newChatDefaultsLimits;return l?{max_context_window:Math.ceil(l.maximumUsableWindow*100/l.effectivePercent),effective_context_window_percent:l.effectivePercent,...(l.extended?{context_ceiling:920000,context_compact_ceiling:904000}:{})}:null;}
function defaultsPage(){return `<div class="content"><div><h1>${e(t('全局默认','Global defaults'))}</h1><p class="muted">${e(t('只影响之后创建的新聊天；分支继续继承父聊天预算。','Only affects new chats. Forks continue to inherit their parent budget.'))}</p></div>${budgetCard(draft,defaultModel(),{defaults:true})}<div class="actions"><button class="primary" data-action="save-defaults" ${!draft?'disabled':''}>${e(t('保存默认值','Save defaults'))}</button><button data-action="copy-current" ${!current()?'disabled':''}>${e(t('使用当前聊天设置','Use current chat settings'))}</button><button class="flat" data-action="reload">${e(t('取消','Cancel'))}</button></div>${state.newChatDefaultsPending?`<div class="state-card">${e(t('已有连接需要重开 Codex 才能加载新聊天默认功能。','Restart Codex to load defaults support in older connections.'))}</div>`:''}</div>`;}
function setNotice(message,error=false){mainNotice=message||'';mainNoticeError=error;const node=document.getElementById('main-notice');if(node){node.textContent=t(mainNotice);node.hidden=!mainNotice;node.classList.toggle('error',error);node.classList.toggle('muted',!error);}}
function refreshBudgetValidity(){
  if(editingDefaults()||mode==='tray')return;
  let error=budgetInputError;try{if(!error){if(!draft)throw Error('等待当前模型的原生窗口信息');applePolicyForDraft(draft,current()?.modelMetadata,current());}}catch(failure){error=failure.message;}
  const fieldset=editorRoot()?.querySelector('.budget-editor');if(fieldset)fieldset.disabled=!draft||current()?.modelMetadata?.context_catalog_ready===false;
  const node=editorRoot()?.querySelector('#budget-error');if(node){node.textContent=t(error||'');node.hidden=!error;}
  for(const action of ['apply']){const button=editorRoot()?.querySelector(`[data-action="${action}"]`);if(button)button.disabled=!!error||!draft;}
}
function openDetails(){
  if(!current()||mode!=='main')return;
  if(detailsOpen){render();return;}
  detailsRestoreScroll=detailsScrollByChat.get(selected)||0;
  detailsOpen=true;detailsEpoch++;view='chat';stats=null;statsJSON='';statsError='';statsLoading=false;deferredStats=null;rawSelectedID=null;lastDetailBucket=null;hover=pinned=null;page=0;
  render();void loadStats(true);
}
function closeDetails(){
  if(!detailsOpen)return;
  detailsScrollByChat.set(selected,root.querySelector('.main')?.scrollTop||0);
  detailsOpen=false;detailsRestoreScroll=null;smoothingInteracting=false;detailsEpoch++;statsLoading=false;deferredStats=null;hover=pinned=null;clearTimeout(smoothingTimer);
}
function acceptStats(result){const json=JSON.stringify(result);if(json===statsJSON)return false;statsJSON=json;stats=result;return true;}
function applyDeferredStats(){if(deferredStats&&detailsOpen&&!settingsOpen&&!dragging&&!mainScroll.active&&hover==null&&!smoothingInteracting){const result=deferredStats;deferredStats=null;if(acceptStats(result))render();}}
function trayEdited(value){return !!value&&(value.window!==value.baseWindow||value.compact!==value.baseCompact);}
function trayChanged(value){return !!value&&(trayEdited(value)||!value.baseEnabled);}
function trayTarget(chat,value){
  if(trayFeedback.has(chat.id))return trayFeedback.get(chat.id).message;
  if(chat.observedWindow!=null&&Math.floor(displayedContextWindow(chat)/1000)!==Math.floor(value.window/1000))return t('目标 {0}K · {1} {2}K','Target {0}K · {1} {2}K',Math.floor(value.window/1000),chat.connected&&chat.freshUsage?t('实际','Actual'):t('上次','Last'),Math.floor(displayedContextWindow(chat)/1000));
  return value.window===draftLimits(chat.modelMetadata,value.window,value.reserve).maximum?'MAX':t('上下文 {0}K','Context {0}K',Math.floor(value.window/1000));
}
function updateTrayAvailability(){
  if(mode!=='tray')return;
  for(const row of root.querySelectorAll('.tray-row')){
    const chat=state?.threads.find(item=>item.id===row.dataset.id);if(!chat)continue;
    let value=trayDrafts.get(chat.id);
    if(value&&!traySaving.has(chat.id)&&(value.modelKey!==modelSignature(chat)||(!trayEdited(value)&&value.expectedRevision!==(chat.policy?.revision??0)))){value=threadDraft(chat);if(value)trayDrafts.set(chat.id,value);}
    if(value)updateTrayDraft(chat.id,value,chat.modelMetadata);
  }
}
function render(force=false){
  if(!force&&mainScroll.active&&!settingsOpen&&['chat','queue','queue-task'].includes(view)&&root.querySelector('.main')?.dataset.chatId===selected&&root.querySelector('.main')?.dataset.view===view){scrollRenderPending=true;return;}
  cancelChartPointer();
  hideChartTooltip();
  if(mode==='tray'){renderTray();return;}
  if(!settingsOpen&&shortcutRecording)finishShortcutRecording();
  const oldMain=root.querySelector('.main'),same=oldMain?.dataset.view===view&&oldMain?.dataset.chatId===selected,open=same?[...oldMain.querySelectorAll('details')].map((d,i)=>d.open?i:-1).filter(i=>i>=0):[],scroll=same?oldMain.scrollTop:0;
  const settingsScroll=root.querySelector('.settings-body')?.scrollTop||0;
  const focusID=document.activeElement?.closest('.details-page')?document.activeElement.id:null;
  const body=settingsOpen?settingsUnderlay:view==='queue-task'?queueTaskEditor({draft:queueTaskDraft,tab:queueTaskTab,expanded:queueExpanded,modelOpen:queueModelOpen,previews:queuePreviews,quota:state?.quota,models:state?.queueModels??[],chats:state?.threads??[],id:queueID,e,t}):view==='queue'?queueDetail({quota:state?.quota,id:queueID,queues:state?.taskQueues,chats:state?.threads??[],e,t}):view==='quota'?quotaAnalyticsView({forecastOverlay:qaForecastOverlay,outlookMetric:qaOutlookMetric,outlookOverlay:qaOutlookOverlay,outlookOverlayCount:qaOutlookOverlayCount,outlookSmoothing:qaOutlookSmoothing,outlookStartText:qaOutlookStart,outlookEndText:qaOutlookEnd,report:qaReport,section:qaSection,period:qaPeriod,costPeriod:qaCostPeriod,costMode:qaCostMode,analysisMode:qaAnalysisMode,costDate:qaCostDate,costStartText:qaCostStart,costEndText:qaCostEnd,loading:qaLoading,error:qaError,days:qaDays,selectedScope:qaScope,selectedModel:qaModel,e,t}):`${preferences.demo?demoBanner():''}${editingDefaults()?defaultsPage():chatPage()}`;
  root.innerHTML=`<div class="shell ${view==='quota'?'analytics-shell':''}" style="--sidebar-width:${visibleSidebarWidth()}px" ${settingsOpen?'inert':''}>${view==='quota'?'':sidebar()}<main class="main" id="main-content" data-view="${view}" data-chat-id="${e(selected)}">${body}</main></div>${settingsOpen?settingsDialog():''}`;
  const newMain=root.querySelector('.main');for(const [i,d]of [...newMain.querySelectorAll('details')].entries())if(open.includes(i))d.open=true;const targetScroll=['queue','queue-task'].includes(view)?(same?scroll:0):detailsOpen?(detailsRestoreScroll??(same?scroll:detailsScrollByChat.get(selected)||0)):scroll;
  if(newMain.querySelector('#phase')){newMain.querySelector('#phase').textContent=phase(current());newMain.querySelector('#phase').title=t(current()?.message||'');}
  if(settingsOpen)root.querySelector('.settings-body').scrollTop=settingsScroll;
  for(const form of root.querySelectorAll('#queue-add,#queue-config')){const values=queueFormDrafts.get(queueID+':'+form.id);if(values)for(const input of form.querySelectorAll('[name]'))if(input.name in values){if(input.type==='checkbox')input.checked=values[input.name];else input.value=values[input.name];}}
  bindSliders();bindSidebar();bindQuotaAnalytics(root);if(detailsOpen&&stats&&!settingsOpen&&view==='chat')drawCharts();
  newMain.scrollTop=targetScroll;if(detailsOpen&&stats&&!statsLoading)detailsRestoreScroll=null;
  if(focusID)document.getElementById(focusID)?.focus({preventScroll:true});
}
async function loadQuotaAnalytics(force=false){
  const epoch=++qaEpoch;qaLoading=true;qaError='';render();
  try{const report=await api.invoke('quota-analytics',{days:qaDays,outlookOverlayCount:qaOutlookOverlayCount,outlookSmoothing:qaOutlookSmoothing,...(qaOutlookRange||{}),costDate:qaCostDate||undefined,...(qaCostRange||{}),scope:qaScope||undefined,model:qaModel||undefined,pool:qaPool||preferences.quotaPool||undefined,refresh:force});if(epoch!==qaEpoch)return;qaReport=report;qaLastLoad=Date.now();}
  catch(error){if(epoch===qaEpoch)qaError=error.message;}
  finally{if(epoch===qaEpoch){qaLoading=false;if(view==='quota')render();}}
}
function openQuotaAnalytics(){if(settingsOpen)closeSettings();if(detailsOpen)closeDetails();view='quota';render();void loadQuotaAnalytics();}
function demoBanner(){return `<div class="demo-banner row between"><div><strong>${e(t('合成数据预览 · 3 个示例聊天','Preview · 3 sample chats'))}</strong><p class="tiny">${e(t('这里不读取真实聊天；切换到本地模式可查看你的聊天。','Preview does not read real chats. Switch to local mode to see your chats.'))}</p></div><button class="small" data-action="open-live">${e(t('查看真实聊天','View real chats'))} ↗</button></div>`;}
function integrationSettings(){
  const integration=preferences.integration||{enabled:false,available:false};
  return `<section class="card stack"><h2>${e(t('Codex 接入','Codex integration'))}</h2><div class="state-card">${e(integrationPending?t('正在检查启动链…','Checking startup…'):integration.enabled?t('已启用；下次重开 Codex 后生效','Enabled; takes effect after restarting Codex'):t('已关闭','Disabled'))}</div><p class="muted">${e(t('安装时默认接入 Codex，可在这里关闭。查看本地聊天无需保持接入。','Installation enables Codex integration by default. You can disable it here; local chat browsing still works.'))}</p><p class="tiny muted">${e(t('实时预算控制需要接入。启用会登记启动入口和统计 Hook；关闭后恢复原启动配置，均在下次重开 Codex 后生效。','Live budget control needs integration. Enabling registers the launcher and statistics hook; disabling restores startup. Restart Codex for either change to take effect.'))}</p><div class="row wrap"><button class="${integration.enabled?'':'primary'}" data-action="integration-toggle" ${busy||integrationPending||!integration.available||preferences.demo?'disabled':''}>${e(integration.enabled?t('关闭接入','Disable integration'):t('手动启用接入','Enable integration manually'))}</button></div>${preferences.demo?`<p class="tiny muted">${e(t('预览模式不修改 Codex 启动配置。','Preview does not change Codex startup.'))}</p>`:''}${integrationError||integration.error?`<p class="error tiny" role="alert">${e(integrationError||integration.error)}</p>`:''}<div class="row"><button data-action="open-logs">${e(t('打开接入日志','Open integration logs'))}</button></div><p class="integration-log-note">${e(t('日志记录启动阶段、耗时和收发字节数，不记录聊天正文。','Logs record startup stages, timing and byte counts, without chat content.'))}</p></section>`;
}
function shortcutSettings(){
  const shortcut=preferences.shortcut||{accelerator:DEFAULT_SHORTCUT,enabled:true},status=!shortcut.enabled?t('已关闭','Disabled'):shortcut.inactive?t('当前未注册系统快捷键','System shortcut not registered'):shortcut.registered?t('快捷键已生效','Shortcut active'):t(shortcut.error||'快捷键尚未注册','Shortcut is not registered');
  return `<div class="content"><section class="card stack"><div class="row between"><h2>${e(t('显示 / 隐藏主窗口','Show / hide main window'))}</h2><label class="row tiny"><span>${e(t('启用全局快捷键','Enable global shortcut'))}</span><input id="shortcut-enabled" class="switch" type="checkbox" ${shortcutEnabled?'checked':''}></label></div><p class="muted">${e(t('默认 Ctrl + Shift + M：按一次显示，再按一次隐藏，可自定义。','Default: Ctrl + Shift + M. Press to show or hide; the shortcut is customizable.'))}</p><label class="stack tiny" for="shortcut-input">${e(t('快捷键','Shortcut'))}<input id="shortcut-input" type="text" class="shortcut-input ${shortcutRecording?'recording':''}" value="${e(shortcutRecording?t('按下组合键…','Press a key combination…'):shortcutDraft?shortcutLabel(shortcutDraft):'')}" ${shortcutRecording?'readonly':''} spellcheck="false" autocomplete="off"></label><div class="row wrap"><button data-action="shortcut-record">${e(shortcutRecording?t('取消录制','Cancel recording'):t('录制快捷键','Record shortcut'))}</button><button data-action="shortcut-reset">${e(t('恢复默认','Restore default'))}</button><button data-action="shortcut-clear">${e(t('清空快捷键','Clear shortcut'))}</button><span class="grow"></span><button class="primary" data-action="shortcut-save">${e(t('保存设置','Save settings'))}</button></div><div class="state-card ${shortcut.error?'error':''}" role="status">${e(status)}</div><p class="tiny muted">${e(t('可直接输入 Ctrl+Alt+K 等组合，或录制按键。按 Esc 取消录制。','Type a combination such as Ctrl+Alt+K, or record it. Press Esc to cancel recording.'))}</p><p class="tiny muted">${e(t('管理器驻留系统托盘时生效；完全退出后不再响应。','Works while the manager is running in the system tray. It stops when the manager exits.'))}</p>${preferences.demo?`<p class="tiny demo-notice">${e(t('预览设置与真实模式分开；请在真实模式中保存常用快捷键。','Preview preferences are separate. Save your shortcut in local mode for regular use.'))}</p>`:''}</section></div>`;
}
function quotaPanel(compact=false){
  const quota=state?.quota,buckets=quota?.buckets||[],bucket=selectedQuota(quota,preferences.quotaPool),windows=quotaWindows(bucket),stale=quotaStale(quota);
  const period=window=>quotaPeriod(window,t);
  const credit=observeCreditBalance(null,bucket?.creditBalance),baseline=creditBaselines[bucket?.id]?.baseline;
  const creditControls=compact?'':`<div class="stack"><button data-action="quota-analytics">▥ ${e(t('额度分析','Quota analytics'))}</button><div class="row wrap"><button data-action="credit-baseline-reset" ${!credit||bucket?.unlimitedCredits||stale||quota?.loading||!serviceAvailable?'disabled':''}>${e(t('重置 Credits 基准','Reset Credits baseline'))}</button>${Number.isFinite(baseline)?`<span class="tiny muted">${e(t('当前基准：{0}','Current baseline: {0}',baseline.toLocaleString(preferences.language==='zh'?'zh-CN':'en-US',{maximumFractionDigits:20})))}</span>`:''}</div><p class="tiny muted">${e(t('将当前余额设为新的 100%；余额增加时也会自动更新基准。','Use the current balance as the new 100%. Balance increases also reset the baseline automatically.'))}</p></div>`;
  return `<section class="quota-panel ${compact?'compact':'card stack'}"><div class="row between"><h2>${e(t('账户额度','Account quota'))}</h2><button class="small" data-action="quota-refresh" ${busy||quota?.loading?'disabled':''} aria-label="${e(t('刷新额度','Refresh quota'))}">↻ ${e(t('刷新','Refresh'))}</button></div>${buckets.length>1?`<label class="stack tiny" for="quota-pool">${e(t('额度类型','Quota pool'))}<select id="quota-pool">${buckets.map(item=>`<option value="${e(item.id)}" ${item.id===bucket?.id?'selected':''}>${e(item.name)}</option>`).join('')}</select></label>`:''}${windows.map(window=>`<div class="quota-window ${quotaLevel(window.remainingPercent)}"><div class="row between"><span class="muted">${e(period(window))}</span><strong class="num">${e(t('剩余 {0}%','{0}% remaining',Math.round(window.remainingPercent)))}</strong></div><div class="quota-meter"><i style="width:${Math.max(0,Math.min(100,window.remainingPercent))}%"></i></div><div class="tiny muted quota-reset">${quotaReset(window,{t,escape:e,language:preferences.language})}</div></div>`).join('')||`<p class="tiny muted">${e(quota?.loading?t('正在读取额度…','Reading quota…'):t(quota?.error||'额度暂不可用','Quota unavailable'))}</p>`}${bucket?.creditBalance!=null||bucket?.hasCredits||bucket?.unlimitedCredits?`<p class="tiny muted">${e(bucket?.unlimitedCredits?t('额外额度不限量','Unlimited extra credits'):bucket?.creditBalance!=null?t('额外额度：{0}','Extra credits: {0}',bucket.creditBalance):t('额外额度可用','Extra credits available'))}</p>`:''}${creditControls}${stale&&windows.length?`<span class="tiny error">${e(t('上次记录，待刷新','Cached observation; refresh needed'))}</span>`:''}${compact?'':`<p class="tiny muted">${e(t('通过官方运行时读取，每 10 秒检查变化；不创建聊天或生成模型回复。','Read through the official runtime and checked for changes every 10 seconds, without creating chats or model output.'))}</p>`}</section>`;
}
function generalSettings(){
  const ext=state?.contextExtension,u=state?.update||{};
  return `<section class="card stack"><h2>${e(t('通用','General'))}</h2><label class="stack tiny" for="language">${e(t('语言','Language'))}<select id="language"><option value="auto" ${preferences.selection==='auto'?'selected':''}>${e(t('自动（按时区）','Automatic (time zone)'))}</option><option value="zh" ${preferences.selection==='zh'?'selected':''}>中文</option><option value="en" ${preferences.selection==='en'?'selected':''}>English</option></select></label><div class="row wrap"><button data-action="scan">↻ ${e(t('同步本地聊天','Sync local chats'))}</button><button data-action="open-codex">↗ ${e(t('打开 Codex','Open Codex'))}</button></div><div class="extension"><div class="row between"><span>${e(t('拓展上下文','Extended context'))}</span><input type="checkbox" id="extension" class="switch" aria-label="${e(t('拓展上下文','Extended context'))}" ${ext?.enabled?'checked':''} ${!ext?.available||!ext?.compatible?'disabled':''}></div><p class="tiny muted">${e(t(ext?.message||'等待 Codex 连接','Waiting for Codex'))}</p></div><div class="extension"><label class="row between" for="auto-check-updates"><span>${e(t('启动时自动检查更新','Check for updates on startup'))}</span><input type="checkbox" id="auto-check-updates" class="switch" ${preferences.autoCheckUpdates!==false?'checked':''}></label><p class="tiny muted">${e(t('发现新版本时提示，由你决定是否安装。','Show a prompt when an update is available. You choose when to install.'))}</p></div><div class="row wrap"><button data-action="update" ${['downloading','installing'].includes(u.phase)?'disabled':''}>↓ ${e(['downloading','installing'].includes(u.phase)?t('正在更新…','Updating…'):u.available?t('安装更新 {0}','Install update {0}',u.version):t('检查更新','Check for updates'))}</button><button data-action="check-update" ${['downloading','installing'].includes(u.phase)?'disabled':''} ${u.available?'':'hidden'}>↻ ${e(t('检查更新','Check for updates'))}</button><span class="tiny muted">v${e(preferences.version||'')}</span></div>${u.error?`<span class="tiny error" role="status">${e(t(u.error))}</span>`:''}<div class="row wrap"><button data-action="diagnostics">${e(t('诊断','Diagnostics'))}</button><button data-action="open-logs">${e(t('打开接入日志','Open integration logs'))}</button></div><div class="feature-note"><strong>${e(t('提前压缩修复','Early compaction fix'))}</strong><p class="tiny muted">${e(t('上游已停用此旧版补丁，Windows 不提供该开关。原生自动压缩与聊天页的压缩触发阈值仍可使用。','The legacy patch is disabled upstream and unavailable on Windows. Native automatic compaction and per-chat thresholds remain available.'))}</p></div></section>`;
}
function settingsDialog(){
  if(settingsTab==='accounts')loginRendered=JSON.stringify(loginState);
  const tabs=[['accounts',t('账号切换','Account switching')],['activation',t('额度启动','Quota activation')],['general',t('通用','General')],['defaults',t('全局默认','Global defaults')],['queues',t('任务队列','Task queues')],['quota',t('账户额度','Account quota')],['cloud',t('云同步','Cloud sync')],['integration',t('Codex 接入','Codex integration')],['shortcut',t('快捷键','Shortcut')]];
  const content=settingsTab==='accounts'?accountSwitchView(loginState,{e,t,pool:preferences.quotaPool,language:preferences.language}):settingsTab==='activation'?activationView(state?.quotaActivation,activationDraft,{e,t}):settingsTab==='cloud'?cloudSyncView(cloudState,{e,t}):settingsTab==='queues'?queueManager({queues:state?.taskQueues,chats:state?.threads??[],e,t}):settingsTab==='general'?generalSettings():settingsTab==='defaults'?(state?defaultsPage():''):settingsTab==='quota'?quotaPanel():settingsTab==='integration'?integrationSettings():shortcutSettings();
  return `<div class="settings-backdrop" data-action="settings-dismiss"><section class="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title"><header class="settings-header row between"><h1 id="settings-title">${e(t('设置','Settings'))}</h1><button class="settings-close flat" data-action="settings-close" aria-label="${e(t('关闭设置','Close settings'))}">×</button></header><nav class="settings-tabs" role="tablist" aria-label="${e(t('设置分类','Settings sections'))}">${tabs.map(([id,label])=>`<button role="tab" id="settings-tab-${id}" aria-controls="settings-panel" aria-selected="${id===settingsTab}" class="${id===settingsTab?'active':''}" data-action="settings-tab" data-tab="${id}">${e(label)}</button>`).join('')}</nav><div class="settings-body" id="settings-panel" role="tabpanel" aria-labelledby="settings-tab-${settingsTab}">${content}</div></section></div>`;
}
function openSettings(tab='general'){
  for(const menu of root.querySelectorAll('.queue-permission-menu,.queue-attach-menu,.queue-model-menu'))menu.open=false;queueModelOpen=false;
  if(!settingsOpen){settingsSnapshot={draft:draft?{...draft}:null,dirty};settingsUnderlay=root.querySelector('.main')?.innerHTML||'';}
  if(shortcutRecording)finishShortcutRecording();
  settingsOpen=true;settingsTab=tab;hover=pinned=null;if(tab==='cloud')void loadCloudSync();if(tab==='accounts')void pollLogins();
  shortcutDraft=preferences.shortcut?.accelerator??DEFAULT_SHORTCUT;shortcutEnabled=shortcutDraft!==''&&preferences.shortcut?.enabled!==false;shortcutDirty=false;
  if(tab==='defaults')loadDraft();render();root.querySelector('.settings-close')?.focus();
}
function closeSettings(){
  if(shortcutRecording)finishShortcutRecording();settingsOpen=false;
  if(settingsSnapshot){draft=settingsSnapshot.draft;dirty=settingsSnapshot.dirty;}
  settingsSnapshot=null;settingsUnderlay='';if(!dirty)loadDraft();render(true);root.querySelector('.settings-trigger')?.focus();
}
function switchSettingsTab(tab){
  if(!['accounts','general','defaults','quota','queues','cloud','integration','shortcut','activation'].includes(tab))return;
  if(shortcutRecording)finishShortcutRecording();
  settingsTab=tab;if(tab==='cloud')void loadCloudSync();if(tab==='accounts')void pollLogins();
  if(tab==='defaults')loadDraft();else if(settingsSnapshot){draft=settingsSnapshot.draft;dirty=settingsSnapshot.dirty;}
  render();root.querySelector('.settings-body').scrollTop=0;root.querySelector(`[data-tab="${tab}"]`)?.focus();
}
function finishShortcutRecording(){shortcutRecording=false;api.invoke('shortcut-recording',{active:false}).catch(()=>{});const field=document.getElementById('shortcut-input');if(field){field.readOnly=false;field.value=shortcutLabel(shortcutDraft);field.classList.remove('recording');}const button=root.querySelector('[data-action="shortcut-record"]');if(button)button.textContent=t('录制快捷键','Record shortcut');}
let quotaOutlineObserver;
function bindSidebar(){
  quotaOutlineObserver??=new ResizeObserver(entries=>{for(const {target} of entries)resizeQuotaOutline(target);});
  quotaOutlineObserver.disconnect();for(const svg of root.querySelectorAll('.quota-outline')){resizeQuotaOutline(svg);quotaOutlineObserver.observe(svg);}
  for(const region of root.querySelectorAll('[data-sidebar-scroll]'))region.scrollTop=sidebarScroll.get(region.dataset.sidebarScroll)||0;
  const side=root.querySelector('.sidebar');if(!side||side.querySelector('.sidebar-resizer'))return;
  const handle=document.createElement('div');handle.className='sidebar-resizer';handle.tabIndex=0;handle.setAttribute('role','separator');handle.setAttribute('aria-orientation','vertical');handle.setAttribute('aria-label',t('调整侧栏宽度','Resize sidebar'));side.append(handle);
  const apply=value=>{sidebarWidth=Math.max(310,Math.min(380,value));root.querySelector('.shell')?.style.setProperty('--sidebar-width',visibleSidebarWidth()+'px');handle.setAttribute('aria-valuenow',String(visibleSidebarWidth()));localStorage.setItem('sidebar-width',String(sidebarWidth));};
  handle.setAttribute('aria-valuemin','310');handle.setAttribute('aria-valuemax','380');handle.setAttribute('aria-valuenow',String(visibleSidebarWidth()));
  handle.addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();dragging=true;handle.setPointerCapture(event.pointerId);});
  handle.addEventListener('pointermove',event=>{if(handle.hasPointerCapture(event.pointerId))apply(event.clientX);});
  handle.addEventListener('pointerup',event=>{if(handle.hasPointerCapture(event.pointerId)){apply(event.clientX);handle.releasePointerCapture(event.pointerId);}dragging=false;});handle.addEventListener('pointercancel',()=>dragging=false);
  handle.addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();apply(event.key==='Home'?310:event.key==='End'?380:sidebarWidth+(event.key==='ArrowLeft'?-10:10));}});
}
function setDraft(which,value,model=current()?.modelMetadata){
  if(!draft||!model)return;const limit=draftLimits(model,draft.window,draft.reserve);
  value=Math.round(value/1000)*1000;
  if(which==='window')draft=resizeDraft(draft,Math.max(editingDefaults()?34000:2000,Math.min(value,limit.maximum)),model);
  else {const compact=Math.max(editingDefaults()?17000:1000,Math.min(value,limit.compact));draft={...draft,compact,ratioCompact:compact,ratioWindow:draft.window};}
  interactionId=which;dirty=true;updateDraftDOM();
}
function updateDraftDOM(){
  const model=editingDefaults()?defaultModel():current()?.modelMetadata;if(!draft||!model)return;
  const limit=draftLimits(model,draft.window,draft.reserve),s=editorRoot()?.querySelector('[data-slider="main"]');if(!s)return;
  const blue=draft.compact/limit.maximum*100,white=draft.window/limit.maximum*100,maxMode=model.context_ceiling===920000&&draft.window===920000;
  s.querySelector('.fill').style.width=blue+'%';s.querySelector('.fill').classList.toggle('max-flow',maxMode);
  s.querySelector('.headroom-fill').style.left=blue+'%';s.querySelector('.headroom-fill').style.width=Math.max(0,white-blue)+'%';
  s.querySelector('.thumb.compact').style.left=blue+'%';s.querySelector('.thumb:not(.compact)').style.left=white+'%';
  updateParticles(s,draft,limit.maximum);
  for(const which of ['compact','window']){const input=s.querySelector(`[data-range="${which}"]`);input.value=draft[which];input.max=which==='window'?limit.maximum:Math.max(1000,limit.compact);input.setAttribute('aria-valuetext',k(draft[which]));s.querySelector(`.thumb${which==='compact'?'.compact':':not(.compact)'}`).classList.toggle('selected',interactionId===which);}
  for(const [id,value]of [['compact-value',k(draft.compact)],['window-value',k(draft.window)],['headroom-value',k(Math.max(0,draft.window-draft.compact))],['raw-window',amount(Math.ceil(draft.window*100/model.effective_context_window_percent))],['max-label',(maxMode?'MAX CONTEXT · ':'')+k(limit.maximum)]]){const n=editorRoot()?.querySelector('#'+id);if(n)n.textContent=value;}
  if(!editingDefaults()){
    const editor=editorRoot(),ratio=draft.compact/draft.window*100;
    editor.querySelector('#max-label').textContent=t('模型上限 {0}K','Model limit {0}K',Math.floor(limit.maximum/1000));
    const ratioLabel=editor.querySelector('#compact-ratio');if(ratioLabel)ratioLabel.textContent=amount(ratio)+'%';
    for(const button of editor.querySelectorAll('[data-action="preset-window"]'))button.classList.toggle('active',Number(button.dataset.value)===draft.window);
    for(const button of editor.querySelectorAll('[data-action="preset-ratio"]'))button.classList.toggle('active',Math.abs(Number(button.dataset.value)-ratio)<.2);
    editor.querySelector('[data-action="preset-compact-max"]')?.classList.toggle('active',draft.compact===limit.compact);
    for(const button of editor.querySelectorAll('[data-action="step"]')){const target=button.dataset.target;button.disabled=Number(button.dataset.step)<0?draft[target]<=(target==='window'?2000:1000):draft[target]>=(target==='window'?limit.maximum:limit.compact);}
  }
  refreshBudgetValidity();
}
function bindSliders(){
  for(const slider of (settingsOpen?editorRoot():document).querySelectorAll('[data-slider]')){
    syncParticleTime(slider);
    const id=slider.dataset.slider,single=slider.dataset.single==='true';let target=null,grabOffset=0;
    const data=()=>id==='main'?{value:draft,model:editingDefaults()?defaultModel():current()?.modelMetadata}: {value:trayDrafts.get(id),model:state.threads.find(t=>t.id===id)?.modelMetadata};
    const move=event=>{const {value,model}=data();if(!value||!model)return;const rect=slider.getBoundingClientRect(),maximum=draftLimits(model,value.window,value.reserve).maximum,n=Math.round(Math.max(0,Math.min(1,(event.clientX-grabOffset-rect.left)/rect.width))*maximum/1000)*1000;
      if(!target){target=single?'window':Math.abs(n-value.compact)<Math.abs(n-value.window)?'compact':Math.abs(n-value.compact)===Math.abs(n-value.window)?interactionId||'window':'window';}
      if(id==='main')setDraft(target,n,model);else{const next=resizeDraft(value,Math.max(2000,Math.min(maximum,n)),model);trayDrafts.set(id,next);updateTrayDraft(id,next,model);}
    };
    slider.addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();dragging=true;if(mode==='tray')api.invoke('interaction',{dragging:true});const thumb=event.target.closest('.thumb');target=thumb?(thumb.classList.contains('compact')?'compact':'window'):null;grabOffset=0;
      if(thumb){const r=thumb.getBoundingClientRect();grabOffset=event.clientX-(r.left+r.width/2);}
      slider.setPointerCapture(event.pointerId);slider.closest('.tray-row')?.classList.add('editing');move(event);});
    let pending=null,frame=null;
    slider.addEventListener('pointermove',event=>{if(!dragging||!slider.hasPointerCapture(event.pointerId))return;pending=event;if(frame==null)frame=requestAnimationFrame(()=>{frame=null;if(pending)move(pending);pending=null;});});
    const end=event=>{if(!slider.hasPointerCapture(event.pointerId))return;if(frame!=null)cancelAnimationFrame(frame);frame=null;pending=null;move(event);slider.releasePointerCapture(event.pointerId);dragging=false;if(mode==='tray')api.invoke('interaction',{dragging:false});target=null;if(id==='main')applyDeferredStats();if(id!=='main'){const row=slider.closest('.tray-row');row?.classList.remove('editing');if(!row?.matches(':hover')){trayDrafts.delete(id);renderTray();}}};
    slider.addEventListener('pointerup',end);slider.addEventListener('pointercancel',event=>{if(frame!=null)cancelAnimationFrame(frame);frame=null;pending=null;dragging=false;if(mode==='tray')api.invoke('interaction',{dragging:false});target=null;slider.closest('.tray-row')?.classList.remove('editing');});
    for(const input of slider.querySelectorAll('[data-range]'))input.addEventListener('input',()=>{if(id==='main')setDraft(input.dataset.range,Number(input.value),data().model);else{const next=resizeDraft(data().value,Number(input.value),data().model);trayDrafts.set(id,next);updateTrayDraft(id,next,data().model);}});
  }
}
function updateTrayDraft(id,value,model){
  const row=[...document.querySelectorAll('.tray-row')].find(row=>row.dataset.id===id),chat=state?.threads.find(chat=>chat.id===id);if(!row||!value||!model||!row.querySelector('.slider'))return;
  const maximum=draftLimits(model,value.window,value.reserve).maximum,percentage=value.window/maximum*100;
  row.querySelector('.fill').style.width=percentage+'%';row.querySelector('.fill').classList.toggle('max-flow',model.context_ceiling===920000&&value.window===920000);row.querySelector('.thumb').style.left=percentage+'%';
  const label=row.querySelector('.tray-value');label.textContent=trayTarget(chat,value);label.classList.toggle('error',trayFeedback.get(id)?.error===true);
  row.querySelector('[data-action="tray-apply"]').disabled=!serviceAvailable||chat.modelMetadata?.context_catalog_ready===false||!trayChanged(value)||traySaving.has(id)||value.modelKey!==modelSignature(chat);
  for(const input of row.querySelectorAll('input'))input.disabled=!serviceAvailable||chat.modelMetadata?.context_catalog_ready===false||traySaving.has(id);
  updateParticles(row.querySelector('.slider'),value,maximum);
}

function trayRow(chat){
  let value=trayDrafts.get(chat.id);if(!value){value=threadDraft(chat);if(value)trayDrafts.set(chat.id,value);}
  const editable=!!value&&chat.modelMetadata?.context_catalog_ready!==false;
  return trayChatView({chat,title:chatName(chat),status:statusText(chat),draft:value,editable,changed:serviceAvailable&&trayChanged(value),saving:traySaving.has(chat.id),target:value?trayTarget(chat,value):'',fraction:observed(chat),slider,ring,e,t});
}

function updateTraySpeeds(){
  for(const row of root.querySelectorAll('.tray-row')){
    const chat=state?.threads.find(t=>t.id===row.dataset.id),running=chat?.connected&&['active','inProgress'].includes(chat.status);
    for(const node of row.querySelectorAll('.tray-speed')){node.hidden=!running;node.innerHTML=responseSpeedContent(chat?.responseSpeed);}
  }
}
function renderTray(force=false){updateTraySpeeds();if(!force&&(dragging||document.querySelector('.tray-row:hover,.tray-row:focus-within')))return;trayDrafts.clear();const {running,recent}=trayState(state?.threads);root.innerHTML=`<div class="tray-shell"><button class="tray-top" data-action="open-main">${e(t('打开主窗口','Open main window'))}<span style="float:right" class="muted tiny">${e(preferences.shortcut?.enabled?shortcutLabel(preferences.shortcut.accelerator):'↗')}</span></button>${quotaPanel(true)}<div class="tray-list"><div class="tray-section row between"><span>${e(t('正在运行','Running'))}</span><span>${running.length}</span></div>${running.map(trayRow).join('')||`<p class="tiny muted" style="padding:0 10px">${e(t('暂无运行中的聊天','No running chats'))}</p>`}${recent.length?`<div class="tray-section row between"><span>${e(t('近期聊天','Recent chats'))}</span><span>${recent.length}</span></div>${recent.map(trayRow).join('')}`:''}</div><div class="tray-footer"><span class="row"><span class="dot ${state?.bridgeCount?'on':''}"></span>Context Manager</span><button class="flat" data-action="quit">${e(t('退出','Quit'))}</button></div></div>`;bindSliders();for(const row of document.querySelectorAll('.tray-row')){row.addEventListener('mouseleave',()=>{if(dragging||traySaving.has(row.dataset.id))return;trayFeedback.delete(row.dataset.id);const chat=state.threads.find(t=>t.id===row.dataset.id),d=threadDraft(chat);if(d){trayDrafts.set(chat.id,d);updateTrayDraft(chat.id,d,chat.modelMetadata);}});row.addEventListener('click',event=>{if(!event.target.closest('button,.slider'))api.invoke('open-main',{id:row.dataset.id});});row.addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target===row)api.invoke('open-main',{id:row.dataset.id});});}}
function detailsPage(){return detailsView({title:chatName(current()),stats,content:stats?statsBody():statsLoading?statsBody():'<div class="empty">'+e(t('暂无上下文统计','No context statistics'))+'</div>',loading:statsLoading,error:statsError,auto,e,t});}

function statsBody(){return statisticsView({stats,period,e,t,k,amount,money,modelName:modelDisplayName});}

function drawCharts(){
  cancelChartPointer();
  const container=document.querySelector('#charts');if(!container||!stats)return;
  const pinPosition=timeline?.buckets[pinned]?.position;timeline=timelineData(stats.responses||[],stats.timelineEvents||[],{period});if(pinPosition!=null)pinned=nearestBucket(timeline,pinPosition);
  const {width:w,height:h,padding}=timelinePlot;
  const plot=(name,series)=>{
    const max=Math.max(1,...series.flatMap(s=>s.points.map(p=>p.value)));
    // Connect available measurements visually without synthesizing samples.
    const paths=series.map(s=>`<path data-series="${s.key}" stroke="${s.color}" d="${s.points.map((point,i)=>(i?'L':'M')+timelineX(point.position,timeline.upperBound).toFixed(2)+','+(h-20-point.value/max*(h-30)).toFixed(2)).join(' ')}"/>`).join('');
    const dots=series.map(s=>`<circle class="chart-selection-point" data-measure="${s.key}" r="3.5" stroke="${s.color}" visibility="hidden"/>`).join('');
    const ticks=[1,.5,0].map(ratio=>({y:h-20-ratio*(h-30),value:ratio*max}));
    const tickLabels=ticks.map(tick=>`<span class="chart-y-tick num" style="top:${tick.y/h*100}%">${e(name==='speed'?amount(tick.value):k(tick.value))}</span>`).join('');
    return `<div class="plot" data-plot="${name}" data-maximum="${max}"><span class="axis">${e(name==='speed'?t('生成速度 · tokens/s','Generation · tokens/s'):t('输入与缓存 · tokens','Input and cache · tokens'))}</span>${tickLabels}<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-label="${e(name==='speed'?t('生成速度趋势','Generation speed trend'):t('输入和缓存趋势','Input and cache trend'))}" role="img">${ticks.map(tick=>`<line class="chart-grid" x1="${padding}" y1="${tick.y}" x2="${w-padding}" y2="${tick.y}"/>`).join('')}${paths}${dots}</svg><i class="chart-cursor"></i></div>`;
  };
  container.innerHTML=plot('speed',[{key:'speed',points:timeline.speed,color:'#6d9dff'}])+`<div class="chart-label chart-legend"><span style="color:#6d9dff">● ${e(t('生成速度','Generation speed'))}</span></div>`+plot('cache',[{key:'input',points:timeline.input,color:'#aaa'},{key:'cache',points:timeline.cache,color:'#78b8cf'}])+`<div class="chart-label chart-legend"><span>● ${e(t('输入','Input'))}</span><span style="color:#78b8cf">● ${e(t('缓存读取','Cached reads'))}</span></div>`+timelineEvents(timeline,{e,t});
  let pending=null,frame=null;
  cancelChartPointer=()=>{if(frame!=null)cancelAnimationFrame(frame);frame=null;pending=null;};
  const select=(plot,event)=>{
    if(mainScroll.active||!plot.isConnected)return;
    const rect=plot.getBoundingClientRect(),position=timelinePosition(event.clientX-rect.left,timeline.upperBound,rect.width);
    chartPointer={x:event.clientX,y:event.clientY};hover=position==null?null:nearestBucket(timeline,position);updateChartSelection();
  };
  for(const plot of container.querySelectorAll('[data-plot]')){
    plot.addEventListener('pointermove',event=>{if(mainScroll.active)return;pending={plot,event};if(frame==null)frame=requestAnimationFrame(()=>{frame=null;if(pending)select(pending.plot,pending.event);pending=null;});});
    plot.addEventListener('pointerleave',()=>{cancelChartPointer();hover=null;updateChartSelection();queueMicrotask(applyDeferredStats);});
    plot.addEventListener('click',event=>{select(plot,event);if(hover!=null)pinned=hover;hover=null;page=0;updateChartSelection();});
  }
  document.querySelector('#raw-records')?.addEventListener('toggle',()=>renderRaw());updateChartSelection();
}
function updateChartSelection(){
  const selectedBucket=timeline?.buckets[hover??pinned],focused=selectedBucket||timeline?.buckets.at(-1),detail=document.querySelector('#chart-detail');
  for(const cursor of document.querySelectorAll('.chart-cursor')){cursor.style.display=selectedBucket?'block':'none';if(selectedBucket)cursor.style.left=timelineX(selectedBucket.position,timeline.upperBound,100)+'%';}
  for(const circle of document.querySelectorAll('.chart-selection-point')){
    const point=selectedBucket?timeline[circle.dataset.measure]?.find(point=>point.id===selectedBucket.id):null;
    circle.setAttribute('visibility',point?'visible':'hidden');if(!point)continue;
    const maximum=Number(circle.closest('[data-plot]').dataset.maximum),h=timelinePlot.height;
    circle.setAttribute('cx',String(timelineX(point.position,timeline.upperBound)));circle.setAttribute('cy',String(h-20-point.value/maximum*(h-30)));
  }
  if(!detail)return;
  if(focused?.id!==lastDetailBucket){page=0;lastDetailBucket=focused?.id;}
  detail.innerHTML=chartDetailView({bucket:focused,pinned:pinned!=null&&hover==null,e,t,k,amount,modelName:modelDisplayName});
  const summary=document.getElementById('raw-summary');if(summary)summary.textContent=t('原始记录（{0} 条）','Raw records ({0})',focused?focused.end-focused.start:0);
  if(document.querySelector('#raw-records')?.open)renderRaw();
  updateChartTooltip(hover!=null?focused:null);
}

function hideChartTooltip(){document.getElementById('chart-hover-tooltip')?.setAttribute('hidden','');chartPointer=null;chartTooltipBucket=null;}
function updateChartTooltip(bucket){
  if(!bucket||!chartPointer||!detailsOpen){hideChartTooltip();return;}
  let node=document.getElementById('chart-hover-tooltip');
  if(!node){node=document.createElement('div');node.id='chart-hover-tooltip';node.className='chart-hover-tooltip';node.setAttribute('aria-hidden','true');document.body.append(node);}
  if(chartTooltipBucket!==bucket.id){node.innerHTML=chartTooltipView({bucket,e,t,k,amount});chartTooltipBucket=bucket.id;}
  node.hidden=false;
  const {width,height}=node.getBoundingClientRect(),gap=18,pad=12;
  const left=chartPointer.x+gap+width<=innerWidth-pad?chartPointer.x+gap:chartPointer.x-gap-width;
  const top=chartPointer.y+gap+height<=innerHeight-pad?chartPointer.y+gap:chartPointer.y-gap-height;
  node.style.left=Math.max(pad,Math.min(left,innerWidth-width-pad))+'px';node.style.top=Math.max(pad,Math.min(top,innerHeight-height-pad))+'px';
}
window.addEventListener('blur',hideChartTooltip);
window.addEventListener('resize',hideChartTooltip);
// Passive listeners never consume the wheel. Cancel stale pointer frames before
// scrolling, and defer DOM replacement until the wheel/trackpad gesture is idle.
const trackMainScroll=event=>{if(event.target instanceof Element&&event.target.closest('.main'))mainScroll.touch();};
document.addEventListener('wheel',trackMainScroll,{capture:true,passive:true});
document.addEventListener('scroll',event=>{if(mainScroll.active)trackMainScroll(event);else hideChartTooltip();},{capture:true,passive:true});

function renderRaw(){
  const node=document.querySelector('#raw-page');if(!node||!timeline)return;
  const bucket=timeline.buckets[hover??pinned]||timeline.buckets.at(-1);if(!bucket){node.textContent=t('暂无记录','No records');return;}
  const entries=timeline.entries.slice(bucket.start,bucket.end),pages=Math.max(1,Math.ceil(entries.length/20));page=Math.max(0,Math.min(page,pages-1));
  node.innerHTML=rawRecordsView({entries,page,pages,selectedID:rawSelectedID,e,t,amount,k,modelName:modelDisplayName});
}

function snapshotInfo(){
  const u=stats.unclassified||{},at=stats.snapshotAt?new Date(stats.snapshotAt).toLocaleString(preferences.language==='zh'?'zh-CN':'en-US'):'';
  return `<div class="notes"><p>${e(stats.snapshotKind==='last_request'?t('最近请求快照 · {0}','Last request snapshot · {0}',at):t('本地保留历史 · 尚无可对齐用量','Retained local history · No aligned usage yet'))}</p><details><summary>${e(t('推理生成统计与统计口径','Reasoning generation and methodology'))}</summary><p>${e(t('本次压缩后、快照之前记录了 {0} 次响应，生成推理 {1}。这是生成量，不是当前保留的推理占用。','{0} responses and {1} generated reasoning tokens since compaction and before the snapshot. This is generation, not retained reasoning usage.',stats.sampledResponses??0,k(stats.reasoningGenerated)))}</p><p>${e(t('* 已识别 {0} 个推理项目、{1} 个不透明压缩项目；另有 {2} 张图片（已包含在消息内）。','{0} reasoning items, {1} opaque compaction items, and {2} images included in messages.',u.reasoningItems??0,u.compactionItems??0,u.images??0))}</p><p>${e(t('普通文本摘要已并入文本，只计一次；不透明压缩内容已合并到其他。此快照包含 {0} 条普通文本摘要。','Plain-text summaries are counted once. Opaque compaction is included in other items. This snapshot has {0} plain-text summaries.',stats.plaintextSummaryItems??0))}</p></details>${u.status==='estimate_exceeds_input'?`<p class="error">${e(t('文本估算超过请求输入量，暂不显示差额；不会将它当作零占用。','Text estimates exceed input usage; the difference is unknown, not zero.'))}</p>`:''}</div>`;
}
async function loadStats(force=false){
  if(!detailsOpen||!selected||settingsOpen||view!=='chat'||dragging||document.hidden&&!force||statsLoading||smoothingInteracting&&!force)return;
  const id=selected,epoch=detailsEpoch;let repaint=force||!stats||!!statsError;statsLoading=true;lastStats=Date.now();if(force||!stats)render();
  try{const result=await api.invoke('statistics',{id,refresh:force});if(id!==selected||!detailsOpen||epoch!==detailsEpoch)return;statsError='';if(dragging||settingsOpen||(hover!=null||smoothingInteracting)&&!force){deferredStats=result;return;}repaint=acceptStats(result)||repaint;}
  catch(error){if(id===selected&&detailsOpen&&epoch===detailsEpoch){statsError=error.message;repaint=true;notify(error.message);}}
  finally{if(epoch===detailsEpoch){statsLoading=false;if(detailsOpen&&!settingsOpen&&!dragging&&id===selected&&hover==null&&!smoothingInteracting&&repaint)render();}}
}

function selectChat(id){
  if(id===selected&&!settingsOpen&&view==='chat')return;
  for(const region of root.querySelectorAll('[data-sidebar-scroll]'))sidebarScroll.set(region.dataset.sidebarScroll,region.scrollTop);
  if(settingsOpen)closeSettings();
  closeDetails();mainNotice='';budgetInputError='';budgetText={};selected=id;
  view='chat';draft=threadDraft(current());dirty=false;stats=null;statsJSON='';statsError='';timeline=null;rawSelectedID=null;lastDetailBucket=null;pinned=hover=null;page=0;
  if(current()&&mode==='main')openDetails();else render();
}
function loadDraft(){if(editingDefaults()){const d=state?.newChatDefaults;draft=d?{window:d.usableWindow,compact:d.compact,reserve:16000,retainedFloor:0,expectedRevision:d.revision}:null;}else{const next=threadDraft(current());if(draft?.expectedRevision!==next?.expectedRevision){budgetText={};budgetInputError='';}draft=next;}dirty=false;}
async function refresh(){if(refreshing||dragging||queueDrag)return;refreshing=true;try{preferences=await api.invoke('preferences');if(settingsOpen&&!shortcutDirty&&!shortcutRecording){shortcutDraft=preferences.shortcut?.accelerator??DEFAULT_SHORTCUT;shortcutEnabled=shortcutDraft!==''&&preferences.shortcut?.enabled!==false;}document.documentElement.lang=preferences.language==='zh'?'zh-CN':'en';const next=await api.invoke('state');observeCredits(next.quota);state=next;serviceAvailable=true;if(view==='quota'&&!settingsOpen){if(!document.activeElement?.closest('.compact-date-range')&&!qaLoading&&Date.now()-qaLastLoad>(qaReport?.quality?.progress?.pending?1500:5000))await loadQuotaAnalytics();else{const side=root.querySelector('.sidebar');if(side){side.outerHTML=sidebar();bindSidebar();}}return;}if(!selected||!current()){const id=state.threads[0]?.id??null;if(detailsOpen&&id!==selected)selectChat(id);else selected=id;}if(!dirty)loadDraft();updateTrayAvailability();if(mode==='main'&&!settingsOpen){if(!detailsOpen&&view==='chat'&&current()){openDetails();}refreshBudgetValidity();}if(settingsOpen&&settingsTab==='activation'){
const holder=document.createElement('div');holder.innerHTML=activationView(state?.quotaActivation,activationDraft,{e,t});
for(const selector of ['[data-activation-status]','[data-activation-recommendation]','[data-activation-schedule]','[data-activation-credits-status]']){const a=root.querySelector(selector),b=holder.querySelector(selector);if(a&&b)a.replaceWith(b);}
const run=root.querySelector('[data-action="activation-run"]');if(run)run.disabled=!!state?.quotaActivation?.busy||['waiting','running','verifying'].includes(state?.quotaActivation?.job?.status);return;
}if(settingsOpen&&settingsTab==='accounts'){void pollLogins();return;}if(settingsOpen&&settingsTab==='cloud'){void pollCloudSync();return;}if(settingsOpen){if(!busy&&!shortcutRecording&&!document.activeElement?.closest('.settings-dialog'))render();return;}if(hover==null&&pinned==null&&!document.activeElement?.matches('input,select,textarea')){if(dirty&&mode==='main'&&root.querySelector('#stats-body')){root.querySelector('.sidebar').outerHTML=sidebar();bindSidebar();}else if(!dirty||mode==='tray')render();else{const side=root.querySelector('.sidebar');if(side){side.outerHTML=sidebar();bindSidebar();}document.querySelector('#phase')?.replaceChildren(document.createTextNode(phase(current())));const message=document.querySelector('#phase-message');if(message)message.textContent=t(current()?.message||'');}}if(detailsOpen&&auto&&Date.now()-lastStats>10000&&hover==null)await loadStats();}catch(error){serviceAvailable=false;if(state){state={...state,quota:state.quota?{...state.quota,stale:true}:state.quota,bridgeCount:0,threads:state.threads.map(t=>({...t,connected:false,freshUsage:false,phase:'disconnected'}))};updateTrayAvailability();render();}if(!state)root.innerHTML=`<div class="empty"><h2>Context Manager</h2><p>${e(error.message)}</p><button data-action="retry">${e(t('重试','Retry'))}</button></div>`;}finally{refreshing=false;}}
root.addEventListener('click',async event=>{const button=event.target.closest('[data-action]');if(!button)return;const action=button.dataset.action;if(button.disabled)return;
  try{
    if(action.startsWith('queue-')&&view==='chat')queueID=selected;
    if(action==='queue-model-popup'){captureQueueTask();queueModelOpen=!queueModelOpen;render(true);return;}
    if(action==='queue-approval'){captureQueueTask();queueTaskDraft.settings.approval=button.dataset.approval;render(true);return;}
    if(action==='queue-expand'){captureQueueTask();queueExpanded=!queueExpanded;render(true);document.getElementById('queue-prompt')?.focus();return;}
    if(action==='queue-model-reset'){captureQueueTask();queueTaskDraft.settings.effort='';render(true);return;}
    if(action==='queue-model'){captureQueueTask();queueTaskDraft.settings.model=button.dataset.model;queueTaskDraft.settings.effort='';render(true);root.querySelector('.queue-model-menu').open=false;return;}
    if(action==='queue-add-open'){openQueueTask();return;}
    if(action==='queue-task-back'){queueTaskDraft=null;view='queue';render();return;}
    if(action==='queue-editor-tab'){captureQueueTask();queueTaskTab=button.dataset.tab;render(true);return;}
    if(action==='queue-attach'){captureQueueTask();const result=await run('queue-pick-files',{kind:button.dataset.kind});if(result)mergeQueueAttachments(result.attachments);return;}
    if(action==='queue-attachment-remove'){captureQueueTask();queueTaskDraft.settings.attachments.splice(Number(button.dataset.index),1);render();return;}
    if(action==='queue-open'){queueID=button.dataset.id;queueReturnSettings=settingsOpen;if(settingsOpen)closeSettings();view='queue';render();return;}
    if(action==='queue-back'){view='chat';render();if(queueReturnSettings)openSettings('queues');return;}
    if(action==='queue-toggle'){const id=button.dataset.id,q=state?.taskQueues?.queues.find(q=>q.id===id);await queueCommand({id,action:'enable',enabled:!q?.enabled});return;}
    if(action==='queue-resume'){await queueCommand({id:queueID,action:'enable',enabled:true});return;}
    if(action==='queue-disable-all'){await queueCommand({action:'disable-all'});return;}
    if(action.startsWith('queue-')){
      const q=state?.taskQueues?.queues.find(q=>q.id===queueID),taskId=button.dataset.taskId;
      if(action==='queue-pause-cycle'){await queueCommand({id:queueID,action:'pause-cycle'});return;}
      if(action==='queue-edit'){openQueueTask(taskId);return;}
      if(['queue-delete','queue-retry','queue-stop'].includes(action)){await queueCommand({id:queueID,taskId,action:action.slice(6)});return;}
      if(['queue-up','queue-down'].includes(action)){const order=q.tasks.map(t=>t.id),from=order.indexOf(taskId),to=from+(action==='queue-up'?-1:1);[order[from],order[to]]=[order[to],order[from]];await queueCommand({id:queueID,action:'reorder',order});return;}
    }
    if(action.startsWith('login-')){
      const id=button.dataset.id;
      if(action==='login-switch'){const next=await switchSavedAccount(api,{id,name:button.dataset.name});if(!next)return;loginState=next;}
      else if(action==='login-remove'){const reply=await api.invoke('confirm-login-remove');if(!reply.confirmed)return;loginState=await api.invoke('account-switch',{action:'remove',id});}
      else if(action==='login-rename'){const input=[...root.querySelectorAll('[data-login-name]')].find(n=>n.dataset.loginName===id);loginState=await api.invoke('account-switch',{action:'rename',id,name:input.value});}
      else if(action==='login-add'||action==='login-embedded'){loginState=await api.invoke('account-switch',{action:'login',name:root.querySelector('#login-name').value,browser:action==='login-embedded'?'embedded':'system'});}
      else if(action==='login-capture')loginState=await api.invoke('account-switch',{action:'capture'});
      else if(action==='login-cancel')loginState=await api.invoke('account-switch',{action:'cancel'});
      render();return;
    }
    if(action==='cloud-account-rename'){
      const input=[...root.querySelectorAll('[data-cloud-account-name]')].find(n=>n.dataset.cloudAccountName===button.dataset.id);
      cloudState=await api.invoke('cloud-sync',{action:'rename-account',id:button.dataset.id,name:input.value});render();return;
    }
    if(action==='cloud-account-delete'){
      const answer=await api.invoke('confirm-account-delete');if(!answer?.confirmed)return;
      cloudState=await api.invoke('cloud-sync',{action:'delete-account',id:button.dataset.id});state=await api.invoke('state');qaReport=null;render();return;
    }
    if(action==='cloud-save'){cloudState=await api.invoke('cloud-sync',cloudSyncForm(root));render();notify(t('同步设置已保存','Sync settings saved'));return;}
    if(action==='cloud-run'){cloudState=await api.invoke('cloud-sync',{...cloudSyncForm(root),action:'save-and-sync'});render();return;}
    if(action==='cloud-copy'){const field=button.dataset.field;await api.invoke('cloud-copy-credential',{field,value:root.querySelector('#cloud-'+field).value});notify(t(field==='token'?'Token 已复制':'同步密钥已复制',field==='token'?'Token copied':'Sync key copied'));return;}
    if(action==='cloud-refresh'){await pollCloudSync();return;}
    if(action==='cloud-create-gist'){const result=await api.invoke('cloud-sync',{action:'create-gist',token:root.querySelector('#cloud-token').value.trim()});root.querySelector('#cloud-gist').value=result.gistId;return;}
    if(action==='cloud-generate'){const bytes=crypto.getRandomValues(new Uint8Array(32));const input=root.querySelector('#cloud-key');input.value=Array.from(bytes,v=>v.toString(16).padStart(2,'0')).join('');input.type='text';input.focus();input.select();return;}
    if(action==='cloud-guide'){await api.invoke('open-reference',{id:'cloud-sync'});return;}
    if(action==='settings'){openSettings();return;}
    if(action==='settings-close'){closeSettings();return;}
    if(action==='settings-dismiss'){if(event.target===button)closeSettings();return;}
    if(action==='settings-tab'){switchSettingsTab(button.dataset.tab);return;}
    if(action==='open-reference'){await api.invoke(action,{id:button.dataset.reference});return;}
    if(action==='quota-details'){openSettings('quota');return;}
    if(action==='credit-baseline-reset'){
      const bucket=selectedQuota(state?.quota,preferences.quotaPool),next=observeCreditBalance(null,bucket?.creditBalance);
      if(!next||bucket?.unlimitedCredits||quotaStale(state?.quota,serviceAvailable)||state?.quota?.loading)return;
      if(state?.capabilities?.creditBaseline){const quota=await run('quota-credit-baseline',{id:bucket.id});state.quota=quota;observeCredits(quota);render();notify(t('Credits 基准已重置','Credits baseline reset'));return;}
      const saved={...creditBaselines,[bucket.id]:next};
      localStorage.setItem('credit-baselines',JSON.stringify(saved));creditBaselines=saved;render();
      notify(t('Credits 基准已重置','Credits baseline reset'));return;
    }
    if(action==='quota-analytics'){openQuotaAnalytics();return;}
    if(action==='qa-close'){++qaEpoch;qaLoading=false;view='chat';openDetails();return;}
    if(action==='qa-mode'){qaAnalysisMode=button.dataset.mode;render();return;}
  if(action==='cost-reset'){qaCostRange=null;qaCostStart='';qaCostEnd='';await loadQuotaAnalytics(true);return;}
  if(action==='cost-mode'){qaCostMode=button.dataset.mode;render();return;}
  if(action==='cost-period'){qaCostPeriod=button.dataset.period;render();return;}
  if(action==='qa-section'){qaSection=button.dataset.section;render();return;}
    if(action==='qa-period'){qaPeriod=button.dataset.period;if(!qaOutlookRange){qaOutlookStart='';qaOutlookEnd='';}render();return;}
    if(action==='outlook-cycle'){qaOutlookRange=null;qaOutlookStart=qaOutlookEnd='';await loadQuotaAnalytics();return;}
    if(action==='qa-refresh'){await run('quota-refresh');await loadQuotaAnalytics(true);return;}
    if(action.startsWith('activation-')){
      let params={action:action==='activation-run'?'run':action==='activation-cancel'?'cancel':'configure'};
      if(params.action==='configure'){
        params={...params,notificationsEnabled:document.getElementById('activation-notifications').checked,creditsNotificationsEnabled:document.getElementById('activation-credits-notifications').checked,stopOnCreditsEnabled:document.getElementById('activation-credits-stop').checked,creditsTrigger:document.getElementById('activation-credits-trigger').value,weeklyEnabled:document.getElementById('activation-weekly').checked,toleranceMinutes:Number(document.getElementById('activation-tolerance').value),scheduleMode:document.getElementById('activation-mode').value,scheduleTime:document.getElementById('activation-time').value};
      }
      const submittedDraft=activationDraft,result=await api.invoke('quota-activation',params);
      state={...state,quotaActivation:result};if(activationDraft===submittedDraft)activationDraft=null;
      render(true);return;
    }
    if(action==='quota-refresh'){await run('quota-refresh');await refresh();if(settingsOpen)render();return;}
    if(action==='integration-toggle'){
      const enabled=preferences.integration?.enabled!==true;
      integrationPending=true;integrationError='';render();
      try{
        const integration=await run('integration-set',{enabled});if(integration)preferences.integration=integration;
        notify(enabled?t('接入已启用；请在工作结束后重开 Codex。','Integration enabled. Restart Codex after finishing your work.'):t('接入已关闭；下次重开 Codex 使用原入口。','Integration disabled. Codex will use its previous launcher after restart.'));
      }catch(error){integrationError=error.message;throw error;}
      finally{integrationPending=false;render();}return;
    }
    if(action==='shortcut-record'){
      if(shortcutRecording){finishShortcutRecording();return;}
      shortcutEnabled=true;
      await api.invoke('shortcut-recording',{active:true});shortcutRecording=true;render();document.getElementById('shortcut-input')?.focus();return;
    }
    if(action==='shortcut-reset'){finishShortcutRecording();shortcutDraft=DEFAULT_SHORTCUT;shortcutEnabled=true;shortcutDirty=true;render();return;}
    if(action==='shortcut-clear'){finishShortcutRecording();shortcutDraft='';shortcutEnabled=false;shortcutDirty=true;render();return;}
    if(action==='shortcut-save'){
      finishShortcutRecording();await api.invoke('shortcut-recording',{active:false});
      const saved=await run('shortcut-save',{accelerator:shortcutDraft.trim()?normalizeShortcut(shortcutDraft):'',enabled:shortcutEnabled});
      preferences.shortcut=saved;shortcutDraft=saved.accelerator;shortcutEnabled=saved.enabled;shortcutDirty=false;render();notify(saved.inactive?t('预览设置已保存；真实模式中需单独保存。','Preview preference saved. Save it separately in local mode.'):t('快捷键设置已保存','Shortcut settings saved'));return;
    }
    if(action==='recent-toggle'){
      recentExpanded=button.getAttribute('aria-expanded')!=='true';localStorage.setItem('recent-expanded',String(recentExpanded));
      root.querySelector('.sidebar').outerHTML=sidebar();bindSidebar();root.querySelector('[data-action="recent-toggle"]')?.focus({preventScroll:true});return;
    }
    if(action==='project-toggle'){
      projectExpansion.set(button.dataset.id,button.getAttribute('aria-expanded')!=='true');localStorage.setItem('project-expansion',JSON.stringify([...projectExpansion]));
      root.querySelector('.sidebar').outerHTML=sidebar();bindSidebar();
      [...root.querySelectorAll('[data-action="project-toggle"]')].find(item=>item.dataset.id===button.dataset.id)?.focus({preventScroll:true});return;
    }
    if(action==='select'){selectChat(button.dataset.id);return;}
    if(action==='target'){interactionId=button.dataset.target;editorRoot()?.querySelector(`[data-range="${interactionId}"]`)?.focus();updateDraftDOM();return;}
    if(action==='step'){setDraft(button.dataset.target,draft[button.dataset.target]+Number(button.dataset.step),editingDefaults()?defaultModel():current()?.modelMetadata);return;}
    if(action==='preset-window'){setDraft('window',Number(button.dataset.value),editingDefaults()?defaultModel():current()?.modelMetadata);return;}
    if(action==='preset-ratio'){setDraft('compact',draft.window*Number(button.dataset.value)/100,editingDefaults()?defaultModel():current()?.modelMetadata);return;}
    if(action==='preset-compact-max'){setDraft('compact',draftLimits(current().modelMetadata,draft.window,draft.reserve).compact);return;}
    if(action==='reload'){budgetInputError='';budgetText={};loadDraft();render();return;}
    if(action==='defaults'){openSettings('defaults');return;}
    if(action==='copy-current'){const d=threadDraft(current());if(d){draft={...d,expectedRevision:state.newChatDefaults.revision};const limit=draftLimits(defaultModel(),Math.min(d.window,defaultModel()?draftLimits(defaultModel(),d.window).maximum:d.window));draft.window=Math.min(d.window,limit.maximum);draft.compact=Math.min(d.compact,limit.compact);dirty=true;render();}return;}
    if(action==='save-defaults'){await run('defaults',{usableWindow:draft.window,compact:draft.compact,expectedRevision:draft.expectedRevision},t('默认值已保存','Defaults saved'));dirty=false;await refresh();if(settingsOpen)render();return;}
    if(action==='compact'){await run('compact',{id:selected});await refresh();return;}
    if(action==='apply'){
      if(budgetInputError)throw Error(budgetInputError);
      const params={id:selected,...budgetCommand(draft,policyForDraft(draft,current().modelMetadata),state.capabilities),expectedRevision:draft.expectedRevision,apply:true};
      try{
        await run('policy',params);dirty=false;setNotice(t('预算已保存，实际窗口将在下一轮请求后确认。'));await refresh();
      }catch(error){setNotice(error.message,true);throw error;}return;
    }
    if(action==='scan'){await run('scan');await refresh();if(settingsOpen)render();return;}
    if(action==='update'||action==='check-update'){const result=await run(action==='update'&&state.update?.available?'install-update':'check-update');await refresh();if(settingsOpen)render();if(result?.error)notify(result.error);else if(!result?.available)notify(t('已是最新版本','You are up to date'));return;}
    if(action==='refresh-stats'){hover=null;await loadStats(true);return;}
    if(action==='raw-prev'||action==='raw-next'){page+=action==='raw-next'?1:-1;renderRaw();return;}
    if(action==='raw-select'){const index=timeline?.byID.get(button.dataset.id);if(index!=null){rawSelectedID=button.dataset.id;pinned=timeline.mapping[index];hover=null;updateChartSelection();}return;}
    if(action==='tray-apply'){
      const chat=state.threads.find(t=>t.id===button.dataset.id),d=trayDrafts.get(chat?.id);if(!d||!serviceAvailable||traySaving.has(chat.id)||!trayChanged(d))return;
      traySaving.add(chat.id);updateTrayDraft(chat.id,d,chat.modelMetadata);
      try{
        if(d.modelKey!==modelSignature(chat))throw Error(t('模型信息已变化，请重新调整','Model metadata changed. Adjust again.'));
        const result=await api.invoke('policy',{id:chat.id,...budgetCommand(d,policyForDraft(d,chat.modelMetadata),state.capabilities),expectedRevision:d.expectedRevision,apply:true});
        if(result.thread){state.threads=state.threads.map(item=>item.id===chat.id?{...item,...result.thread}:item);}
        const code=result.plan?.code,updated=state.threads.find(item=>item.id===chat.id),messages={waiting_for_idle:t('已保存 · 本轮结束后应用','Saved · apply after this turn'),needs_compaction:t('已保存 · 需先压缩再应用','Saved · compaction required'),needs_observation:t('已保存 · 等待用量读回','Saved · waiting for usage')};
        trayFeedback.set(chat.id,{message:!updated.connected?t('已保存 · 接入后自动应用','Saved · apply when connected'):messages[code]||t('已提交 · 等待读回确认','Submitted · awaiting confirmation'),error:code==='needs_compaction'});
        const next=threadDraft(updated);if(next)trayDrafts.set(chat.id,next);
      }catch(error){trayFeedback.set(chat.id,{message:error.message,error:true});}
      finally{traySaving.delete(chat.id);const updated=state.threads.find(item=>item.id===chat.id);updateTrayDraft(chat.id,trayDrafts.get(chat.id),updated.modelMetadata);}
      return;
    }

    if(action==='diagnostics'){const data=await api.invoke('diagnostics');notify(JSON.stringify(data));return;}
    if(action==='retry'){await refresh();return;}
    if(['open-main','open-codex','quit','open-live','open-logs'].includes(action))await api.invoke(action);
  }catch(error){if(action==='apply'&&!settingsOpen)setNotice(error.message,true);notify(error.message);}
});
root.addEventListener('pointerdown',event=>{if(event.target.id==='smoothing')smoothingInteracting=true;});
window.addEventListener('pointerup',()=>{if(smoothingInteracting){smoothingInteracting=false;queueMicrotask(applyDeferredStats);}});
window.addEventListener('pointercancel',()=>{smoothingInteracting=false;});
root.addEventListener('change',async event=>{
  if(event.target.matches('[data-cloud-quota-account]')){const input=event.target;input.disabled=true;try{cloudState=await api.invoke('cloud-sync',{action:'set-account-visibility',id:input.dataset.cloudQuotaAccount,visible:input.checked});state=await api.invoke('state');}catch(error){input.checked=!input.checked;notify(error.message);}finally{input.disabled=false;}return;}
  if(event.target.id==='cloud-provider'){root.querySelector('[data-cloud-repository]').hidden=event.target.value==='gist';root.querySelector('[data-cloud-gist]').hidden=event.target.value!=='gist';return;}
  if(event.target.id==='cloud-interval'){root.querySelector('[data-cloud-custom]').hidden=event.target.value!=='-1';return;}

  if(event.target.id==='forecast-overlay'){qaForecastOverlay=event.target.checked;render();return;}
  if(event.target.id==='outlook-overlay'){qaOutlookOverlay=event.target.checked;if(!qaOutlookRange){qaOutlookStart='';qaOutlookEnd='';}render();return;}
  if(['outlook-overlay-count','forecast-overlay-count'].includes(event.target.id)){qaOutlookOverlayCount=Number(event.target.value);if(!qaOutlookRange){qaOutlookStart='';qaOutlookEnd='';}await loadQuotaAnalytics();return;}
  if(event.target.id==='outlook-smoothing'){qaOutlookSmoothing=Number(event.target.value);await loadQuotaAnalytics();return;}
  if(event.target.id==='outlook-metric'){qaOutlookMetric=event.target.value;render();return;}
  if(event.target.id==='cost-date'){qaCostDate=event.target.value;await loadQuotaAnalytics(true);return;}
  if(['cost-start','cost-end','outlook-start','outlook-end'].includes(event.target.id)){
    const cost=event.target.id.startsWith('cost-'),prefix=cost?'cost':'outlook',startText=root.querySelector('#'+prefix+'-start').value,endText=root.querySelector('#'+prefix+'-end').value,start=Date.parse(startText),end=Date.parse(endText);
    if(cost){qaCostStart=startText;qaCostEnd=endText;}else{qaOutlookStart=startText;qaOutlookEnd=endText;}
    if(Number.isFinite(start)&&Number.isFinite(end)&&end>start&&end-start<=366*86400000&&(!cost||start<=Date.now())){if(cost){qaCostRange={costStart:start,costEnd:end};qaCostDate=startText.slice(0,10);}else qaOutlookRange={outlookStart:start,outlookEnd:end};await loadQuotaAnalytics(true);}
    return;
  }
  if(['qa-days','qa-scope','qa-pool','qa-outlook-pool','qa-model'].includes(event.target.id)){if(event.target.id==='qa-model')qaModel=event.target.value;else if(event.target.id==='qa-days')qaDays=Number(event.target.value);else if(event.target.id==='qa-scope'){qaScope=event.target.value;qaPool='';}else qaPool=event.target.value;await loadQuotaAnalytics(true);return;}const target=event.target;try{
  if(target.id==='auto-check-updates'){const result=await api.invoke('update-preferences',{enabled:target.checked});preferences.autoCheckUpdates=result.enabled;}
  if(target.id==='language'){await api.invoke('language',{selection:target.value});preferences=await api.invoke('preferences');render();}
  if(target.id==='quota-pool'){await api.invoke('quota-select',{id:target.value});preferences.quotaPool=target.value;render();}
  if(target.id==='shortcut-enabled'){if(target.checked&&!shortcutDraft.trim()){shortcutDraft=DEFAULT_SHORTCUT;shortcutEnabled=true;render();}else shortcutEnabled=target.checked;shortcutDirty=true;}
  if(target.id==='extension'){await run('extension',{enabled:target.checked});dirty=false;await refresh();render();}
  if(target.id==='reserve'||target.id==='retained'){
    budgetText[target.id]=target.value;
    try{const value=tokenNumber(target.value,target.id==='reserve'?'下一轮预留':'必须保留量');draft={...draft,[target.id==='reserve'?'reserve':'retainedFloor']:value};dirty=true;budgetInputError='';updateDraftDOM();}
    catch(error){budgetInputError=error.message;refreshBudgetValidity();setNotice(error.message,true);}
  }
  if(target.id==='auto-stats')auto=target.checked;
  if(target.id==='smoothing'){clearTimeout(smoothingTimer);period=Number(target.value);hover=null;drawCharts();}
}catch{await refresh();}});
root.addEventListener('input',event=>{if(event.target.id==='shortcut-input'&&!shortcutRecording){shortcutDraft=event.target.value;shortcutDirty=true;}if(event.target.id==='smoothing'){period=Number(event.target.value);document.getElementById('smoothing-label').textContent=period<2?t('关闭','Off'):'EMA '+period;clearTimeout(smoothingTimer);smoothingTimer=setTimeout(()=>{hover=null;if(detailsOpen)drawCharts();},120);}});
document.addEventListener('keydown',event=>{
  if(!shortcutRecording)return;event.preventDefault();event.stopImmediatePropagation();
  if(event.key==='Escape'){finishShortcutRecording();return;}
  try{const accelerator=shortcutFromEvent(event);if(!accelerator)return;shortcutDraft=accelerator;shortcutDirty=true;finishShortcutRecording();}catch(error){notify(error.message);}
},true);

document.addEventListener('keydown',event=>{
  if(!settingsOpen)return;
  if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();closeSettings();return;}
  if(event.key!=='Tab')return;
  const modal=root.querySelector('.settings-dialog'),fields=[...modal.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]')];
  const first=fields[0],last=fields.at(-1);
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
},true);
document.addEventListener('keydown',event=>{if(event.key==='Escape'){if(mode==='tray')api.invoke('hide');else if(pinned!=null){pinned=null;hover=null;updateChartSelection();}else if(view!=='chat'){view='chat';openDetails();}}});
function visibility(){const now=performance.now();if(particleClock.running)particleClock.elapsed+=now-particleClock.at;particleClock.at=now;particleClock.running=!document.hidden&&document.hasFocus();if(mode==='tray'&&document.hidden)renderTray(true);document.body.classList.toggle('hidden',document.hidden);document.body.classList.toggle('focused',document.hasFocus());if(!document.hidden)refresh();}
document.addEventListener('visibilitychange',visibility);window.addEventListener('focus',visibility);window.addEventListener('blur',visibility);visibility();
window.addEventListener('blur',()=>{if(shortcutRecording)finishShortcutRecording();});
window.addEventListener('resize',()=>root.querySelector('.shell')?.style.setProperty('--sidebar-width',visibleSidebarWidth()+'px'));
api.onSelect(id=>selectChat(id));api.onRefresh(()=>refresh());
api.onSettings(()=>openSettings());
function chartGeometryCheck(){
  const container=document.getElementById('charts'),before=container.style.width;let maxError=0,samples=0;
  for(const width of [320,704,1080]){
    container.style.width=width+'px';
    for(const bucket of [timeline.buckets[0],timeline.buckets[Math.floor(timeline.buckets.length/2)],timeline.buckets.at(-1)]){
      if(!bucket)continue;hover=bucket.id;pinned=null;updateChartSelection();
      for(const plot of container.querySelectorAll('[data-plot]')){
        const rect=plot.getBoundingClientRect(),cursor=plot.querySelector('.chart-cursor').getBoundingClientRect(),x=cursor.left+cursor.width/2;
        maxError=Math.max(maxError,Math.abs(x-(rect.left+timelineX(bucket.position,timeline.upperBound,rect.width))));
        for(const point of plot.querySelectorAll('.chart-selection-point[visibility="visible"]')){const p=point.getBoundingClientRect();maxError=Math.max(maxError,Math.abs(x-(p.left+p.width/2)));samples++;}
        for(const marker of plot.querySelectorAll(`[data-bucket="${bucket.id}"]`)){const p=marker.getBoundingClientRect();maxError=Math.max(maxError,Math.abs(x-(p.left+p.width/2)));samples++;}
      }
    }
  }
  container.style.width=before;hover=pinned=null;updateChartSelection();return {ok:samples>0&&maxError<.75,maxError,samples};
}
window.__contextSmoke=async({preview=false}={})=>{
  const initial=!!state&&!!root.querySelector(mode==='tray'?'.tray-shell':'.shell')&&!!root.querySelector('[data-slider]');let defaults=true,charts=true,settings=true,geometry={ok:true},radius=true,projects=true,quota=true,settingsChanges=true,inlineDetails=true,quickUpdate=true,traySpeed=true;
  if(mode==='main'&&preferences.demo){
    const quotaButton=root.querySelector('.sidebar-quota'),gear=root.querySelector('.settings-trigger'),credits=root.querySelector('.sidebar-credits');
    quota=!!quotaButton&&quotaButton.querySelectorAll('[data-quota-reset]').length===2&&!!credits&&credits.textContent.includes('30.2K')&&credits.title.includes('30,240')&&gear.closest('.brand')&&quotaButton.getBoundingClientRect().left>=credits.getBoundingClientRect().right&&quotaButton.getBoundingClientRect().bottom<=window.innerHeight;
    quota=quota&&getComputedStyle(credits.querySelector('span')).fontSize==='9px'&&getComputedStyle(credits.querySelector('strong')).fontSize==='10px'&&getComputedStyle(credits.querySelector('strong')).fontWeight===getComputedStyle(quotaButton.querySelector('strong')).fontWeight;
    const shell=root.querySelector('.shell');
    for(const width of [310,340,380]){
      shell.style.setProperty('--sidebar-width',width+'px');
      const quotaRows=[...root.querySelectorAll('.sidebar-quota-window')];quota=quota&&Math.abs(quotaRows[0].getBoundingClientRect().width-quotaRows[1].getBoundingClientRect().width)<.01;
      for(const row of quotaRows){
        const label=row.querySelector('.sidebar-quota-label').getBoundingClientRect(),time=row.querySelector('.quota-reset').getBoundingClientRect();
        quota=quota&&label.bottom<=time.top+1&&row.querySelector('.quota-reset').scrollWidth<=Math.ceil(time.width)&&row.getBoundingClientRect().height===44;
        quota=quota&&getComputedStyle(row.querySelector('.quota-reset')).fontSize===getComputedStyle(root.querySelector('.chat-project-name')).fontSize&&getComputedStyle(row.querySelector('.sidebar-quota-label')).fontSize==='11px';
      }
    }
    shell.style.setProperty('--sidebar-width',visibleSidebarWidth()+'px');
    for(const svg of root.querySelectorAll('.quota-outline')){
      resizeQuotaOutline(svg);const path=svg.querySelector('.quota-outline-value'),dot=svg.querySelector('.quota-outline-dot');
      const point=path.getPointAtLength(path.getTotalLength()*Number(svg.dataset.remaining)/100);
      quota=quota&&Math.abs(Number(dot.getAttribute('cx'))-point.x)<.01&&Math.abs(Number(dot.getAttribute('cy'))-point.y)<.01;
    }
    creditBaselines.codex={last:30240,baseline:60480};
    credits.click();quota=quota&&settingsTab==='quota'&&root.querySelector('.settings-body').textContent.includes('30240');
    root.querySelector('[data-action="credit-baseline-reset"]').click();
    quota=quota&&creditBaselines.codex.baseline===30240&&JSON.parse(localStorage.getItem('credit-baselines')).codex.baseline===30240;
    closeSettings();quota=quota&&Number(root.querySelector('.sidebar-credits svg').dataset.remaining)===100;
    root.querySelector('.sidebar-quota').click();quota=quota&&settingsTab==='quota' &&root.querySelectorAll('.settings-body [data-quota-reset]').length===2;closeSettings();
    const savedQuota=state.quota;
    for(const [remaining,level,color] of [[20,'','rgb(69, 128, 252)'],[5,'warning','rgb(237, 196, 90)'],[4,'critical','rgb(255, 107, 114)']]){
      state={...state,quota:{...savedQuota,buckets:[{id:'codex',name:'Codex',primary:{remainingPercent:remaining,windowDurationMins:10080,resetsAt:2000000000}}]}};render();
      const meter=root.querySelector('.sidebar-quota-window');quota=quota&&!!meter&&(!level||meter.classList.contains(level))&&getComputedStyle(meter.querySelector('.quota-outline-value')).stroke===color&&getComputedStyle(meter.querySelector('strong')).color==='rgb(238, 238, 238)'&&!root.querySelector('.sidebar-quota').textContent.includes('5小时');
    }
    state={...state,quota:savedQuota};render();
    projectExpansion.clear();render();
    const collapsedNavigation=root.querySelector('.project-navigation'),recentChat=root.querySelector('.recent-section [data-id="demo-b"]');
    const beforeSelection=recentChat.getBoundingClientRect(),beforeScroll=collapsedNavigation.scrollTop;
    recentChat.click();
    const afterSelection=root.querySelector('.recent-section [data-id="demo-b"]').getBoundingClientRect();
    projects=selected==='demo-b'&&!root.querySelector('.project-chats')&&Math.abs(beforeSelection.top-afterSelection.top)<1&&Math.abs(beforeSelection.left-afterSelection.left)<1&&root.querySelector('.project-navigation').scrollTop===beforeScroll;
    root.querySelector('[data-action="project-toggle"]').click();
    const groups=root.querySelector('.projects-section'),single=root.querySelector('.recent-section');
    projects=projects&&!!groups.querySelector('[data-id="demo-a"]')&&!!single.querySelector('[data-id="demo-c"]')&&!!single.querySelector('[data-id="demo-a"]')&&root.querySelectorAll('[data-sidebar-scroll]').length===1&&getComputedStyle(root.querySelector('.project-navigation')).overflowY==='scroll';
    groups.querySelector('[data-action="project-toggle"]').click();
    projects=projects&&!root.querySelector('.projects-section [data-id="demo-a"]')&&JSON.parse(localStorage.getItem('project-expansion')).some(([id,open])=>id==='demo-project'&&!open);
    render();projects=projects&&!root.querySelector('.projects-section [data-id="demo-a"]');
    root.querySelector('[data-action="project-toggle"]').click();
    root.querySelector('.projects-section [data-id="demo-b"]').click();projects=projects&&selected==='demo-b'&&!!root.querySelector('[data-slider]');
    root.querySelector('.recent-section [data-id="demo-c"]').click();projects=projects&&selected==='demo-c';selectChat(state.threads[0].id);
    const previousActivity=state;state={...state,threads:state.threads.map(chat=>chat.id==='demo-c'?{...chat,lastActivityAt:Date.now()}:chat)};render();
    projects=projects&&root.querySelector('.recent-section .chat-button')?.dataset.id==='demo-c'&&root.querySelectorAll('.recent-section .chat-button').length===3;
    state=previousActivity;render();
    const recentHeight=root.querySelector('.recent-section').getBoundingClientRect().height;
    root.querySelector('[data-action="recent-toggle"]').click();
    projects=projects&&!root.querySelector('.recent-section .chat-button')&&root.querySelector('.recent-section').getBoundingClientRect().height<recentHeight&&localStorage.getItem('recent-expanded')==='false';
    render();projects=projects&&!root.querySelector('.recent-section .chat-button');
    root.querySelector('[data-action="recent-toggle"]').click();projects=projects&&root.querySelectorAll('.recent-section .chat-button').length===3;
    const navigation=root.querySelector('.project-navigation'),projectSection=root.querySelector('.projects-section'),recentSection=root.querySelector('.recent-section');
    const gutterGap=root.querySelector('.sidebar').getBoundingClientRect().right-navigation.getBoundingClientRect().right;projects=projects&&gutterGap>=0&&gutterGap<=4;
    const sidebarContentWidth=navigation.clientWidth;navigation.style.maxHeight='120px';navigation.scrollTop=0;
    const projectTop=projectSection.getBoundingClientRect().top,recentTop=recentSection.getBoundingClientRect().top;
    navigation.scrollTop=32;
    projects=projects&&navigation.clientWidth===sidebarContentWidth&&navigation.scrollTop===32&&Math.abs(projectTop-projectSection.getBoundingClientRect().top-32)<1&&Math.abs(recentTop-recentSection.getBoundingClientRect().top-32)<1;
    navigation.style.maxHeight='';navigation.scrollTop=0;


    radius=['[data-action="apply"]','#language','.sidebar-footer>button'].every(selector=>[...root.querySelectorAll(selector)].every(node=>getComputedStyle(node).borderTopLeftRadius==='10px'));
    openSettings('defaults');defaults=root.querySelector('.settings-dialog').querySelectorAll('[data-range]').length===2;closeSettings();
    selectChat(state.threads[0].id);
    const savedRevision=current().policy.revision;
    const windowInput=root.querySelector('[data-range="window"]');windowInput.value='800000';windowInput.dispatchEvent(new Event('input',{bubbles:true}));
    const editedBudget=JSON.stringify(draft);
    inlineDetails=current().policy.revision===savedRevision&&dirty&&root.querySelectorAll('[data-slider="main"]').length===1&&!root.querySelector('[data-action="stats"],[data-action="preflight"],[data-action="clear"]');
    const deadline=Date.now()+5000;while(!document.querySelector('[data-plot]')&&Date.now()<deadline)await new Promise(r=>setTimeout(r,30));
    charts=document.querySelectorAll('[data-plot]').length===3&&!!timeline?.entries.length;if(charts)geometry=chartGeometryCheck();
    if(charts){
      const changed=timeline.buckets.find(b=>b.settingsChanges.some(change=>change.field==='model'));
      chartPointer={x:innerWidth-360,y:230};hover=changed?.id??null;updateChartSelection();
      const tooltip=document.getElementById('chart-hover-tooltip');
      settingsChanges=!!changed&&tooltip?.textContent.includes('GPT-6 Sol → GPT-6.1 Sol')&&tooltip.textContent.includes('Medium → XHigh')&&tooltip.textContent.includes('⚡ Fast')&&!tooltip.hidden&&!!tooltip.querySelector('.response-time')?.textContent;
      const ultra=timeline.buckets.find(b=>b.speedModes.includes('ultrafast'));hover=ultra?.id??null;updateChartSelection();settingsChanges=settingsChanges&&tooltip.textContent.includes('⚡⚡ Ultrafast');hideChartTooltip();hover=null;
    }
    inlineDetails=inlineDetails&&!!root.querySelector('.main .details-page')&&!root.querySelector('.details-backdrop,[aria-modal="true"]')&&!root.querySelector('.shell').inert;
    inlineDetails=inlineDetails&&!root.querySelector('.details-back')&&dirty&&JSON.stringify(draft)===editedBudget&&!!root.querySelector('[data-slider]');
    const waitDetails=async id=>{const until=Date.now()+4000;while((stats?.threadId!==id||statsLoading)&&Date.now()<until)await new Promise(r=>setTimeout(r,25));return stats?.threadId===id&&!statsLoading;};
    inlineDetails=await waitDetails('demo-a')&&inlineDetails;
    root.querySelector('.main').scrollTop=320;const scrollA=root.querySelector('.main').scrollTop;
    await loadStats(true);inlineDetails=inlineDetails&&dirty&&JSON.stringify(draft)===editedBudget&&Math.abs(root.querySelector('.main').scrollTop-scrollA)<1;
    root.querySelector('[data-action="apply"]').click();
    const savedUntil=Date.now()+5000;while((current().policy.revision===savedRevision||busy||refreshing)&&Date.now()<savedUntil)await new Promise(r=>setTimeout(r,25));
    inlineDetails=inlineDetails&&current().policy.revision===savedRevision+1&&!dirty;
    root.querySelector('.recent-section [data-id="demo-b"]').click();
    inlineDetails=await waitDetails('demo-b')&&inlineDetails&&detailsOpen&&!root.querySelector('.details-back')&&root.querySelector('#details-title').getBoundingClientRect().top>root.querySelector('[data-slider="main"]').getBoundingClientRect().bottom;
    root.querySelector('.main').scrollTop=120;
    root.querySelector('.recent-section [data-id="demo-a"]').click();
    inlineDetails=await waitDetails('demo-a')&&inlineDetails&&Math.abs(root.querySelector('.main').scrollTop-scrollA)<1;
    selectChat('demo-b');selectChat('demo-c');selectChat('demo-b');inlineDetails=await waitDetails('demo-b')&&inlineDetails&&detailsOpen;
    inlineDetails=inlineDetails&&view==='chat'&&!!root.querySelector('.details-page');
    selectChat(state.threads[0].id);
    openSettings('shortcut');settings=!!document.querySelector('#shortcut-input')&&document.querySelector('#shortcut-input').value==='Ctrl + Shift + M'&&!!document.querySelector('[data-action="shortcut-save"]');
    const saved=await api.invoke('shortcut-save',{accelerator:'Control+Alt+K',enabled:true});preferences=await api.invoke('preferences');settings=settings&&saved.accelerator==='Control+Alt+K'&&preferences.shortcut.accelerator==='Control+Alt+K'&&preferences.shortcut.inactive;
    await api.invoke('shortcut-save',{accelerator:DEFAULT_SHORTCUT,enabled:true});preferences=await api.invoke('preferences');
    closeSettings();openSettings('shortcut');
    const waitShortcut=async predicate=>{const until=Date.now()+4000;while(!predicate()&&Date.now()<until)await new Promise(r=>setTimeout(r,20));return predicate();};
    root.querySelector('[data-action="shortcut-record"]').click();settings=settings&&await waitShortcut(()=>shortcutRecording);
    root.querySelector('[data-action="settings-tab"][data-tab="general"]').click();settings=settings&&!shortcutRecording;
    switchSettingsTab('shortcut');root.querySelector('[data-action="shortcut-record"]').click();settings=settings&&await waitShortcut(()=>shortcutRecording);
    window.dispatchEvent(new Event('blur'));settings=settings&&!shortcutRecording;
    root.querySelector('[data-action="shortcut-clear"]').click();root.querySelector('[data-action="shortcut-save"]').click();settings=settings&&await waitShortcut(()=>!busy&&!shortcutDirty);
    preferences=await api.invoke('preferences');closeSettings();openSettings('shortcut');settings=settings&&preferences.shortcut.accelerator===''&&!preferences.shortcut.enabled&&root.querySelector('#shortcut-input').value==='';
    await api.invoke('shortcut-save',{accelerator:DEFAULT_SHORTCUT,enabled:true});preferences=await api.invoke('preferences');selectChat(state.threads[0].id);
  }
  if(mode==='main'&&preferences.demo){
    const previousUpdate=state.update;
    state={...state,update:{available:true,version:'99.0.0',phase:'idle'}};render();
    const button=root.querySelector('.quick-update'),gear=root.querySelector('.settings-trigger');
    quickUpdate=!!button&&!button.disabled&&button.title.includes('99.0.0')&&button.getBoundingClientRect().right<=gear.getBoundingClientRect().left;
    openSettings('general');quickUpdate=quickUpdate&&!!root.querySelector('.settings-body [data-action="check-update"]:not([hidden])');closeSettings();
    state={...state,update:{available:true,version:'99.0.0',phase:'downloading'}};render();quickUpdate=quickUpdate&&root.querySelector('.quick-update')?.disabled;
    state={...state,update:{available:false,phase:'idle'}};render();quickUpdate=quickUpdate&&!root.querySelector('.quick-update');
    state={...state,update:previousUpdate};render();
  }
  if(mode==='tray'&&preferences.demo){
    const previous=state,active=state.threads.find(chat=>chat.connected&&['active','inProgress'].includes(chat.status));
    if(active){
      state={...state,threads:state.threads.map(chat=>chat.id===active.id?{...chat,responseSpeed:{tokensPerSecond:147.5,direction:'up',samples:[80,120,147.5]}}:chat)};renderTray(true);
      const row=root.querySelector(`.tray-row[data-id="${active.id}"]`);
      traySpeed=row.querySelector('.tray-speed-value').textContent==='147.5 tok/s'&&!row.querySelector('[data-action="tray-cancel"]')&&!!row.querySelector('.speed-direction.up')&&!!row.querySelector('.speed-trend path');
      state={...state,threads:state.threads.map(chat=>chat.id===active.id?{...chat,responseSpeed:{tokensPerSecond:93,direction:'down',samples:[80,120,147.5,93]}}:chat)};updateTraySpeeds();traySpeed=traySpeed&&row.querySelector('.tray-speed-value').textContent==='93 tok/s'&&!!row.querySelector('.speed-direction.down');
      state={...state,threads:state.threads.map(chat=>chat.id===active.id?{...chat,status:'idle'}:chat)};updateTraySpeeds();traySpeed=traySpeed&&getComputedStyle(row.querySelector('.tray-speed')).display==='none';
    }else traySpeed=false;
    state=previous;renderTray(true);
  }
  if(preview&&mode==='main'&&preferences.demo){
    openDetails();const until=Date.now()+5000;while((!stats||!document.querySelector('[data-plot]'))&&Date.now()<until)await new Promise(r=>setTimeout(r,30));
    root.querySelector('.main').scrollTop=0;hover=null;hideChartTooltip();
  }
  return {ok:initial&&defaults&&charts&&settings&&geometry.ok&&radius&&projects&&quota&&settingsChanges&&inlineDetails&&quickUpdate&&traySpeed,mode,chats:state?.threads.length,defaults,charts,settings,geometry,radius,projects,quota,settingsChanges,inlineDetails,quickUpdate,traySpeed,isolated:typeof window.require==='undefined'};
};
await refresh();
setInterval(()=>{if(!document.hidden&&!dragging&&hover==null)refresh();},2000);

setInterval(()=>{if(!document.hidden)for(const node of root.querySelectorAll("[data-quota-reset]"))node.textContent=quotaCountdown(Number(node.dataset.quotaReset),t,Date.now(),node.dataset.quotaCompact==='true');},1000);

window.__contextQuotaSmoke=async function({preview=false}={}){
  qaOutlookMetric='remaining';qaOutlookOverlay=false;qaOutlookOverlayCount=6;qaOutlookStart='';qaOutlookEnd='';qaOutlookRange=null;qaSection='overview';qaAnalysisMode='simple';qaCostDate='';qaCostRange=null;qaCostStart='';qaCostEnd='';openQuotaAnalytics();while(qaLoading)await new Promise(r=>setTimeout(r,20));
  const back=root.querySelector('[data-action="qa-close"]'),main=root.querySelector('.main'),backStyle=getComputedStyle(back);
  const fullWidth=!root.querySelector('.sidebar')&&main.getBoundingClientRect().width===root.querySelector('.shell').getBoundingClientRect().width;
  const borderedBack=backStyle.borderTopStyle==='solid'&&parseFloat(backStyle.borderTopWidth)>0;
  const result={ok:!qaError&&fullWidth&&borderedBack&&root.querySelectorAll('[data-qa-period]').length===3&&root.querySelectorAll('[data-qa-chart]').length===(qaReport.simpleChartIds.length+2)&&!!root.querySelector('#qa-days')&&!!root.querySelector('#qa-model')&&!root.querySelector('[data-section="summary"]'),fullWidth,borderedBack,periods:root.querySelectorAll('[data-qa-period]').length,error:qaError};
  result.simple=!!root.querySelector('[data-qa-chart="ranking"]')&&!root.querySelector('[data-qa-chart="weekly-scatter"]')&&!root.querySelector('[data-action="qa-section"]');
  root.querySelector('[data-action="qa-mode"][data-mode="advanced"]').click();
  result.ok=result.ok&&result.simple&&!!root.querySelector('[data-qa-chart="weekly-scatter"]');
  root.querySelector('[data-action="qa-period"][data-period="credits"]').click();
  result.credits=!!root.querySelector('[data-qa-chart="outlook-credits"]');
  root.querySelector('#outlook-start').value='2026-10-18T10:00';root.querySelector('#outlook-end').value='2026-10-18T12:00';root.querySelector('#outlook-end').dispatchEvent(new Event('change',{bubbles:true}));while(qaLoading)await new Promise(r=>setTimeout(r,20));
  result.outlookRange=qaReport.dashboard.customRange&&!!root.querySelector('[data-qa-chart="outlook-credits"]');
  root.querySelector('[data-action="outlook-cycle"]').click();while(qaLoading)await new Promise(r=>setTimeout(r,20));
  result.ok=result.ok&&result.credits&&result.outlookRange&&!qaReport.dashboard.customRange;
  root.querySelector('[data-action="qa-period"][data-period="weekly"]').click();result.ok=result.ok&&!!root.querySelector('[data-qa-chart="outlook-weekly"]');
  const metricPicker=root.querySelector('#outlook-metric');metricPicker.value='cost';metricPicker.dispatchEvent(new Event('change',{bubbles:true}));
  const overlay=root.querySelector('#outlook-overlay');overlay.checked=true;overlay.dispatchEvent(new Event('change',{bubbles:true}));
  result.priceOverlay=!!root.querySelector('[data-qa-chart="outlook-cost-overlay-weekly"]')&&qaReport.dashboard.periods.find(p=>p.id==='weekly').costOverlayChart.cycleCount===6;
  const smoothing=root.querySelector('#outlook-smoothing');smoothing.value='5';smoothing.dispatchEvent(new Event('change',{bubbles:true}));while(qaLoading)await new Promise(r=>setTimeout(r,20));
  result.priceOverlay=result.priceOverlay&&qaReport.dashboard.periods.find(p=>p.id==='weekly').costOverlayChart.points.some(p=>p.rawY!=null)&&!!root.querySelector('[data-qa-chart="outlook-weekly"]');
  const forecastToggle=root.querySelector('#forecast-overlay');result.forecastOverlay=!forecastToggle.checked;forecastToggle.checked=true;forecastToggle.dispatchEvent(new Event('change',{bubbles:true}));result.forecastOverlay=result.forecastOverlay&&root.querySelectorAll('[data-qa-chart="outlook-overlay-weekly"]').length===1;root.querySelector('#forecast-overlay').checked=false;root.querySelector('#forecast-overlay').dispatchEvent(new Event('change',{bubbles:true}));result.ok=result.ok&&result.forecastOverlay;
  qaOutlookSmoothing=0;await loadQuotaAnalytics();
  const countPicker=root.querySelector('#outlook-overlay-count');countPicker.value='3';countPicker.dispatchEvent(new Event('change',{bubbles:true}));while(qaLoading)await new Promise(r=>setTimeout(r,20));
  result.priceOverlay=result.priceOverlay&&qaReport.dashboard.periods.find(p=>p.id==='weekly').costOverlayChart.cycleCount===3;
  root.querySelector('#outlook-start').value='2026-09-19T00:00';root.querySelector('#outlook-end').value='2026-10-03T23:59';root.querySelector('#outlook-end').dispatchEvent(new Event('change',{bubbles:true}));while(qaLoading)await new Promise(r=>setTimeout(r,20));
  result.priceOverlay=result.priceOverlay&&qaReport.dashboard.customRange&&qaReport.dashboard.periods.find(p=>p.id==='weekly').costOverlayChart.points.every(p=>p.at>=qaOutlookRange.outlookStart&&p.at<=qaOutlookRange.outlookEnd);
  root.querySelector('[data-action="outlook-cycle"]').click();while(qaLoading)await new Promise(r=>setTimeout(r,20));
  qaOutlookOverlayCount=6;qaOutlookMetric='remaining';qaOutlookOverlay=false;await loadQuotaAnalytics();
  result.ok=result.ok&&result.priceOverlay;
  root.querySelector('[data-action="qa-section"][data-section="overview"]').click();result.ok=result.ok&&root.querySelectorAll('[data-qa-chart]').length===8&&root.querySelectorAll('[data-action="qa-section"]').length===4;
  const modelPicker=root.querySelector('#qa-model');
  result.models=!!modelPicker&&modelPicker.options.length>1;
  if(result.models){
    modelPicker.value=modelPicker.options[1].value;const modelID=modelPicker.value;
    modelPicker.dispatchEvent(new Event('change',{bubbles:true}));while(qaLoading)await new Promise(r=>setTimeout(r,20));
    result.models=qaReport?.model===modelID&&root.querySelector('#qa-model')?.value===modelID&&qaReport.charts.find(p=>p.id==='weekly-scatter').points.every(p=>p.series===modelID);
    result.guides=root.querySelectorAll('.qa-help').length===6&&!root.querySelector('.qa-guide')&&!root.querySelector('.qa-note')&&!!root.querySelector('.qa-model-notice');
    const reset=root.querySelector('#qa-model');reset.value='';reset.dispatchEvent(new Event('change',{bubbles:true}));while(qaLoading)await new Promise(r=>setTimeout(r,20));
  }
  result.ok=result.ok&&result.models&&result.guides;
  root.querySelector('[data-action="qa-section"][data-section="trends"]').click();result.ok=result.ok&&!!root.querySelector('[data-qa-chart="outlook-weekly"]')&&!!root.querySelector('[data-qa-chart="forecast"]');
  root.querySelector('[data-action="qa-section"][data-section="overview"]').click();
  const start=root.querySelector('#cost-start'),end=root.querySelector('#cost-end');start.value='2026-10-16T12:00';end.value='2026-10-17T12:00';end.dispatchEvent(new Event('change',{bubbles:true}));while(qaLoading)await new Promise(r=>setTimeout(r,20));
  result.dates=qaReport.costCalendar.selectedDate==='2026-10-16'&&qaReport.costCalendar.customRange&&qaReport.costCalendar.daily.length<=2;
  const rangeBox=root.querySelector('.cost-date-controls').getBoundingClientRect(),cardBox=root.querySelector('.cost-calendar').getBoundingClientRect();
  result.dates=result.dates&&rangeBox.bottom<=cardBox.bottom&&root.querySelectorAll('.cost-date-controls input').length===2&&!root.querySelector('.cost-custom');
  root.querySelector('[data-action="cost-reset"]').click();while(qaLoading)await new Promise(r=>setTimeout(r,20));
  qaCostDate=qaReport.costCalendar.today;await loadQuotaAnalytics(true);
  result.costs=root.querySelectorAll('.cost-cells.year .cost-cell').length===365;
  root.querySelector('[data-action="cost-mode"][data-mode="line"]').click();
  result.costs=result.costs&&!!root.querySelector('.cost-calendar .qa-chart');
  root.querySelector('[data-action="cost-period"][data-period="month"]').click();
  result.costs=result.costs&&!!root.querySelector('[data-action="cost-period"][data-period="month"].active');
  root.querySelector('[data-action="cost-mode"][data-mode="heatmap"]').click();
  root.querySelector('[data-action="cost-period"][data-period="year"]').click();
  root.querySelector('.cost-calendar').scrollIntoView();await new Promise(resolve=>requestAnimationFrame(resolve));
  const toolbar=root.querySelector('.qa-heading').getBoundingClientRect(),viewport=root.querySelector('.main').getBoundingClientRect();
  result.sticky=toolbar.top>=viewport.top-1&&toolbar.top<viewport.top+35;
  const returnRect=root.querySelector('[data-action="qa-close"]').getBoundingClientRect();
  result.sticky=result.sticky&&document.elementFromPoint(returnRect.left+returnRect.width/2,returnRect.top+returnRect.height/2)?.closest('[data-action="qa-close"]')!=null;
  await new Promise(resolve=>setTimeout(resolve,220));
  const heat=root.querySelector('.cost-cell:not(.empty)');heat?.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:200,clientY:200}));
  result.tooltip=!!document.querySelector('#qa-hover-tooltip .chart-tooltip-metrics');
  document.dispatchEvent(new Event('scroll'));result.tooltip=result.tooltip&&!document.querySelector('#qa-hover-tooltip');
  result.chartHover=true;
  let previousGuide;
  for(const svg of [...root.querySelectorAll('.qa-card .qa-chart')].slice(0,2)){
    svg.scrollIntoView({block:'center'});await new Promise(resolve=>setTimeout(resolve,220));
    const point=svg.querySelector('[data-qa-point]'),guide=svg.querySelector('.qa-hover-guide');
    const local=new DOMPoint(+point.dataset.qaX,Math.min(+svg.dataset.qaBottom-1,+svg.dataset.qaTop+20)),screen=local.matrixTransform(svg.getScreenCTM());
    svg.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:screen.x,clientY:screen.y}));
    result.chartHover=result.chartHover&&guide.getAttribute('visibility')==='visible'&&!!document.querySelector('#qa-hover-tooltip .chart-tooltip-metrics')&&(!previousGuide||previousGuide.getAttribute('visibility')==='hidden');
    const before=document.querySelector('#qa-hover-tooltip')?.style.left;
    svg.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:screen.x+4,clientY:screen.y+4}));
    result.chartHover=result.chartHover&&document.querySelector('#qa-hover-tooltip')?.style.left!==before;
    previousGuide=guide;
  }
  document.dispatchEvent(new Event('scroll'));
  result.chartHover=result.chartHover&&!document.querySelector('#qa-hover-tooltip')&&previousGuide?.getAttribute('visibility')==='hidden';
  result.depletionTime=!!root.querySelector('.qa-depletion-time')&&root.querySelector('.qa-depletion-time').textContent.includes(':');
  result.ok=result.ok&&result.depletionTime;
  result.ok=result.ok&&result.chartHover;
  result.ok=result.ok&&result.costs&&result.sticky&&result.tooltip&&result.dates;
  if(!preview){root.querySelector('[data-action="qa-close"]').click();result.ok=result.ok&&!!root.querySelector('.sidebar');}else root.querySelector('.main').scrollTop=0;return result;
};

let scrollProbe=null;
let sliderProbe=null;
window.__contextSliderSmoke=async action=>{
  if(action==='prepare'){
    root.querySelector('.main').scrollTop=0;
    sliderProbe={draft:{...draft},dirty,interactionId};
    const model=current().modelMetadata,maximum=draftLimits(model,draft.window,draft.reserve).maximum;
    setDraft('window',maximum,model);setDraft('compact',draftLimits(model,draft.window,draft.reserve).compact,model);
    sliderProbe.window=draft.window;sliderProbe.compact=draft.compact;
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const thumb=root.querySelector('[data-slider="main"] .thumb:not(.compact)'),r=thumb.getBoundingClientRect();
    const x=Math.floor(r.right-2),y=Math.round(r.top+r.height/2);
    if(document.elementFromPoint(x,y)!==thumb)throw Error('Maximum window handle outer edge is not hit-testable');
    return {x,y};
  }
  if(action==='grab')return {ok:draft.window===sliderProbe.window&&interactionId==='window'};
  const result={ok:draft.window<sliderProbe.window&&draft.compact<sliderProbe.compact&&interactionId==='window',window:draft.window,compact:draft.compact};
  draft=sliderProbe.draft;dirty=sliderProbe.dirty;interactionId=sliderProbe.interactionId;sliderProbe=null;updateDraftDOM();return result;
};
window.__contextScrollSmoke=async function(action){
  if(action==='prepare'){
    const until=Date.now()+5000;while((statsLoading||!root.querySelector('[data-plot]')||mainScroll.active)&&Date.now()<until)await new Promise(r=>setTimeout(r,25));
    const main=root.querySelector('.main'),plot=root.querySelector('[data-plot="speed"]');
    main.scrollTop+=plot.getBoundingClientRect().top-180;
    await new Promise(r=>setTimeout(r,250));
    const currentMain=root.querySelector('.main'),rect=root.querySelector('[data-plot="speed"]').getBoundingClientRect();
    scrollProbe={main:currentMain,lastTop:currentMain.scrollTop,down:false,up:false,stable:true};
    return {x:Math.round(rect.left+rect.width/2),y:Math.round(rect.top+35)};
  }
  if(action==='check'){
    // Native input delivery is asynchronous on hosted Windows runners. Wait for
    // the real wheel listener before simulating an auto-refresh.
    const deadline=Date.now()+2000;while(!mainScroll.active&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
    if(!mainScroll.active)return {active:false,stable:scrollProbe.stable,error:'Native wheel input was not delivered'};
    const main=root.querySelector('.main'),top=main.scrollTop;
    scrollProbe.stable=scrollProbe.stable&&main===scrollProbe.main;
    scrollProbe.down||=top>scrollProbe.lastTop;scrollProbe.up||=top<scrollProbe.lastTop;scrollProbe.lastTop=top;
    // Simulate a concurrent auto-refresh while Chromium owns the wheel gesture.
    render();scrollProbe.stable=scrollProbe.stable&&root.querySelector('.main')===main;
    return {active:mainScroll.active,stable:scrollProbe.stable};
  }
  return {ok:scrollProbe.stable&&scrollProbe.down&&scrollProbe.up,stable:scrollProbe.stable,down:scrollProbe.down,up:scrollProbe.up};
};

async function queueCommand(params){const q=state?.taskQueues?.queues.find(q=>q.id===params.id);const result=await run('task-queue',{expectedRevision:q?.revision??0,...params});if(result){state.taskQueues=result;render();}return result;}
function quotaFromForm(form){const values=new FormData(form),quota={pool:values.get('pool'),resume:values.get('resume'),retryEnabled:values.has('retry-enabled')};for(const key of ['fiveHour','weekly'])quota[key]={reserve:Number(values.get(key+'-reserve')),stages:[0,1,2].filter(i=>values.has(`${key}-${i}-enabled`)).map(i=>({minutes:Number(values.get(`${key}-${i}-minutes`)),reserve:Number(values.get(`${key}-${i}-reserve`))}))};return quota;}
function openQueueTask(taskId){const q=state?.taskQueues?.queues.find(q=>q.id===queueID),task=q?.tasks.find(t=>t.id===taskId);queueTaskDraft={id:task?.id??null,status:task?.status??'draft',prompt:task?.prompt??'',settings:normalizeTaskSettings(task?.settings,q?.config)};queueTaskTab='prompt';queueExpanded=false;queueModelOpen=false;queuePreviews.clear();view='queue-task';render(true);void loadQueuePreviews(queueTaskDraft.settings.attachments);}
function captureQueueTask(){const form=document.getElementById('queue-task-editor');if(!form||!queueTaskDraft)return;const values=new FormData(form);queueTaskDraft.prompt=values.get('prompt')??queueTaskDraft.prompt;queueTaskDraft.settings={...queueTaskDraft.settings,quota:quotaFromForm(form),model:values.get('model')??queueTaskDraft.settings.model,effort:values.get('effort')??queueTaskDraft.settings.effort};for(const control of form.querySelectorAll('[data-queue-prompt-options]'))control.hidden=queueTaskDraft.prompt.trim().toLowerCase()==='/compact';}
function mergeQueueAttachments(files){const found=new Set(queueTaskDraft.settings.attachments.map(f=>f.path));for(const file of files??[])if(file.path&&!found.has(file.path)&&queueTaskDraft.settings.attachments.length<20){found.add(file.path);queueTaskDraft.settings.attachments.push(file);}render(true);void loadQueuePreviews(files);}
root.addEventListener('submit',async event=>{
 const form=event.target;if(!['queue-task-editor','queue-config'].includes(form.id))return;event.preventDefault();
 try{if(form.id==='queue-config'){await queueCommand({id:queueID,action:'config',config:quotaFromForm(form)});return;}
 captureQueueTask();if(!queueTaskDraft.prompt.trim()){queueTaskTab='prompt';render();document.querySelector('[name="prompt"]')?.focus();notify(t('请填写完整任务提示词'));return;}
 const result=await queueCommand({id:queueID,action:queueTaskDraft.status==='running'?'task-config':queueTaskDraft.id?'edit':'add',config:queueTaskDraft.settings.quota,taskId:queueTaskDraft.id,prompt:queueTaskDraft.prompt,settings:queueTaskDraft.settings});if(result){queueTaskDraft=null;view='queue';render();}
 }catch(error){notify(error.message);}
});
root.addEventListener('input',event=>{if(event.target.closest('#queue-task-editor'))captureQueueTask();});
root.addEventListener('change',async event=>{
 if(event.target.matches('[data-queue-account-switch-toggle]')){try{await queueCommand({action:'account-switch',enabled:event.target.checked});}catch(error){render();notify(error.message);}return;}
 if(event.target.matches('[data-queue-global-toggle]')){try{await queueCommand({action:'monitoring',enabled:event.target.checked});}catch(error){render();notify(error.message);}return;}
 if(event.target.matches('[data-queue-toggle]')){try{await queueCommand({id:event.target.dataset.queueToggle,action:'enable',enabled:event.target.checked});}catch(error){render();notify(error.message);}return;}
 if(event.target.closest('#queue-task-editor')&&event.target.name==='model'){captureQueueTask();queueTaskDraft.settings.effort='';render();}
});
root.addEventListener('dragover',event=>{if(view==='queue-task'&&event.dataTransfer.types.includes('Files'))event.preventDefault();});
root.addEventListener('drop',event=>{if(view!=='queue-task'||!event.dataTransfer.files.length||queueTaskDraft?.status==='running')return;event.preventDefault();captureQueueTask();const files=[...event.dataTransfer.files].map(file=>{const path=api.filePath(file);return {path,name:file.name,kind:/\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name)?'image':'file'};});mergeQueueAttachments(files);});

const clearQueueDrag=()=>{queueDrag=null;for(const card of root.querySelectorAll('.queue-task'))card.classList.remove('dragging-task','drop-target');};
root.addEventListener('dragstart',event=>{const card=event.target.closest('[data-task-id].queue-task');if(!card)return;if(card.draggable!==true||event.target.closest('.queue-task-delete')){event.preventDefault();return;}if(view==='chat')queueID=selected;queueDrag=card.dataset.taskId;card.classList.add('dragging-task');event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',queueDrag);});
root.addEventListener('dragover',event=>{const card=event.target.closest('.queue-task[draggable=true]');if(!queueDrag||!card)return;event.preventDefault();event.dataTransfer.dropEffect='move';for(const other of root.querySelectorAll('.drop-target'))other.classList.remove('drop-target');if(card.dataset.taskId!==queueDrag)card.classList.add('drop-target');});
root.addEventListener('drop',async event=>{const card=event.target.closest('.queue-task[draggable=true]');if(!queueDrag||!card)return;event.preventDefault();const q=state.taskQueues.queues.find(q=>q.id===queueID),order=movedQueueOrder(q?.tasks||[],queueDrag,card.dataset.taskId);clearQueueDrag();if(!order)return;try{await queueCommand({id:queueID,action:'reorder',order});}catch(error){notify(error.message);}});
root.addEventListener('dragend',clearQueueDrag);

window.__contextQueueSmoke=async()=>{
 if(!preferences.demo)return {ok:false};
 queueID=selected;view='queue';render();
 await queueCommand({id:queueID,action:'add',prompt:'第一项完整任务：实现 UI 并验证'});
 await queueCommand({id:queueID,action:'add',prompt:'第二项完整任务：修复 Bug 并运行测试'});
 let q=state.taskQueues.queues.find(q=>q.id===queueID);
 render(true);
 const cards=root.querySelectorAll('#queue-tasks .queue-task'),transfer=new DataTransfer();
 cards[1].dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:transfer}));
 await refresh();const dragStable=root.querySelectorAll('#queue-tasks .queue-task')[1]===cards[1];
 cards[0].dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:transfer}));const dropHint=cards[0].classList.contains('drop-target');
 cards[0].dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));
 const deadline=Date.now()+3000;while((state.taskQueues.queues.find(q=>q.id===queueID).tasks[0].id!==q.tasks[1].id||busy)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,20));
 const ordered=state.taskQueues.queues.find(q=>q.id===queueID).tasks[0].id===q.tasks[1].id&&dragStable&&dropHint;
 openQueueTask();const editor=document.querySelector('[data-queue-trigger-effort]')?.textContent==='Medium'&&!!document.querySelector('#queue-task-editor textarea')&&document.querySelectorAll('.queue-stage-row').length===6&&!!document.querySelector('[name=effort]');queueTaskDraft=null;view='queue';render(true);const controls=editor&&!!document.querySelector('#queue-config')&&document.querySelectorAll('.queue-task').length===2;
 const scroller=document.querySelector('.main');scroller.scrollTop=500;await new Promise(r=>requestAnimationFrame(r));const back=document.querySelector('[data-action="queue-back"]').getBoundingClientRect(),parent=document.querySelector('.main').getBoundingClientRect();
 const sticky=back.top>=parent.top&&back.bottom<parent.bottom;
 await queueCommand({id:queueID,action:'disable-all'});
 const off=state.taskQueues.queues.every(q=>!q.enabled)&&!state.taskQueues.sleepPrevented;
 openSettings('queues');let manager=!!document.querySelector('[data-action="queue-disable-all"]')&&!!document.querySelector('[data-queue-global-toggle]');
 for(const enabled of [false,true]){
  document.querySelector('[data-queue-global-toggle]').click();
  const until=Date.now()+3000;while((state.taskQueues.monitoringEnabled!==enabled||busy)&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,20));
  manager=manager&&state.taskQueues.monitoringEnabled===enabled&&document.querySelector('[data-queue-global-toggle]').checked===enabled;
 }
 let accountSwitch=!!document.querySelector('.settings-dialog [data-queue-account-switch-toggle]')&&!document.querySelector('.settings-dialog [data-queue-account-switch-toggle]').checked;
 for(const enabled of [true,false]){document.querySelector('.settings-dialog [data-queue-account-switch-toggle]').click();const until=Date.now()+3000;while((state.taskQueues.accountSwitch?.enabled!==enabled||busy)&&Date.now()<until)await new Promise(r=>setTimeout(r,20));accountSwitch=accountSwitch&&state.taskQueues.accountSwitch?.enabled===enabled&&document.querySelector('.settings-dialog [data-queue-account-switch-toggle]').checked===enabled;}
 closeSettings();view='queue';render();
 return {ok:ordered&&controls&&sticky&&off&&manager&&accountSwitch,ordered,controls,sticky,off,manager,accountSwitch,stickyGeometry:{top:back.top,bottom:back.bottom,parentTop:parent.top,parentBottom:parent.bottom}};
};

root.addEventListener('input',event=>{const form=event.target.closest('#queue-add,#queue-config');if(form){const values={};for(const input of form.querySelectorAll('[name]'))values[input.name]=input.type==='checkbox'?input.checked:input.value;queueFormDrafts.set(queueID+':'+form.id,values);}});

window.__contextQueuePreview=tab=>{
 if(!preferences.demo)return;
 closeSettings();queueID=selected;view='queue';render(true);
 if(tab){openQueueTask(state.taskQueues.queues.find(q=>q.id===queueID)?.tasks[0]?.id);queueTaskTab=tab;render(true);}
};

async function loadQueuePreviews(files){
 for(const file of files??[]){if(file.kind!=='image'||queuePreviews.has(file.path))continue;
  try{const result=await api.invoke('queue-image-preview',{path:file.path});if(!result?.preview)continue;queuePreviews.set(file.path,result.preview);for(const tile of root.querySelectorAll('[data-attachment-path]'))if(tile.dataset.attachmentPath===file.path){const img=tile.querySelector('img');if(img)img.src=result.preview;}}catch{}
 }
}
root.addEventListener('input',event=>{
 if(event.target.id==='queue-prompt'){queueTaskDraft.prompt=event.target.value;const send=root.querySelector('.queue-submit');if(send)send.disabled=!event.target.value.trim();}
 if(!event.target.matches('[data-queue-effort-slider]'))return;
 const id=queueTaskDraft.settings.model||state.threads.find(c=>c.id===queueID)?.model,model=state.queueModels?.find(m=>m.id===id),effort=model?.efforts[Number(event.target.value)];if(!effort)return;
 const form=document.getElementById('queue-task-editor');form.elements.effort.value=effort;captureQueueTask();const label={none:'None',minimal:'Minimal',low:'Low',medium:'Medium',high:'High',xhigh:'Extra high',max:'Max',ultra:'Ultra'}[effort]||effort;
 root.querySelector('[data-queue-effort-label]').textContent=label;root.querySelector('[data-queue-trigger-effort]').textContent=label;event.target.setAttribute('aria-valuetext',label);event.target.parentElement.style.setProperty('--effort-fraction',event.target.value/(event.target.max||1));
});
root.addEventListener('paste',async event=>{
 if(view!=='queue-task'||queueTaskTab!=='prompt'||queueTaskDraft?.status==='running')return;
 const files=[...(event.clipboardData?.files??[])];if(!files.length&&event.target.id!=='queue-prompt')return;
 event.preventDefault();captureQueueTask();const owner=queueTaskDraft,editor=document.getElementById('queue-prompt'),selection=[editor.selectionStart,editor.selectionEnd],text=event.clipboardData?.getData('text/plain')||'';const attachments=[];let needsNative=!files.length;
 for(const file of files){const path=api.filePath(file);if(path)attachments.push({path,name:file.name,kind:file.type.startsWith('image/')?'image':'file'});else needsNative=true;}
 try{
  if(needsNative){const result=await api.invoke('queue-paste-image');attachments.push(...result.attachments);}
  if(queueTaskDraft!==owner)return;
  if(attachments.length)mergeQueueAttachments(attachments);
  else if(text&&document.getElementById('queue-prompt')===editor){editor.focus();editor.setSelectionRange(...selection);document.execCommand('insertText',false,text);editor.dispatchEvent(new Event('input',{bubbles:true}));}
 }catch(error){notify(error.message);}

});

window.__contextComposerSmoke=async()=>{
 if(!preferences.demo)return {ok:false};queueID=selected;openQueueTask();const original='保留完整提示词\n检查附件、模型和放大后的草稿';document.getElementById('queue-prompt').value=original;captureQueueTask();
 const expanded=!document.querySelector('[data-action="queue-expand"]')&&!!document.querySelector('.sidebar');
 const transfer=new DataTransfer();transfer.items.add(new File([new Uint8Array([1])],'clipboard.png',{type:'image/png'}));root.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,clipboardData:transfer}));
 const until=Date.now()+4000;while(!queueTaskDraft.settings.attachments.length&&Date.now()<until)await new Promise(r=>setTimeout(r,30));
 await loadQueuePreviews(queueTaskDraft.settings.attachments);const image=queueTaskDraft.settings.attachments[0];if(!image)return {ok:false,error:'Clipboard attachment missing',toast:document.getElementById('toast')?.textContent};const pasted=image?.kind==='image'&&queuePreviews.has(image.path)&&!!document.querySelector('.queue-attachment-tile img[src]');
 mergeQueueAttachments([{path:'C:\\fixtures\\acceptance.txt',name:'acceptance.txt',kind:'file'}]);const tiles=document.querySelectorAll('.queue-attachment-tile').length===2;
 document.querySelector('[data-action=queue-model-popup]').click();const popover=!!root.querySelector('.queue-model-panel:not([hidden])');document.querySelector('.queue-model-menu').open=true;document.querySelector('[data-action=queue-model][data-model="gpt-6.1-sol"]').click();const modelPicked=queueTaskDraft.settings.model==='gpt-6.1-sol'&&!document.querySelector('.queue-model-menu').open;
 const slider=document.querySelector('[data-queue-effort-slider]');slider.value=2;slider.dispatchEvent(new Event('input',{bubbles:true}));const effort=queueTaskDraft.settings.effort==='high'&&document.querySelector('[data-queue-effort-label]').textContent==='High';
 const retained=!queueExpanded&&document.getElementById('queue-prompt').value===original&&queueTaskDraft.settings.attachments.length===2;
 document.querySelector('[data-action="queue-attachment-remove"]').click();const removed=queueTaskDraft.settings.attachments.length===1;
 document.querySelector('[data-action="queue-approval"][data-approval="full"]').click();const fullPermission=queueTaskDraft.settings.approval==='full'&&!!document.querySelector('.queue-permission-menu.full');
 document.querySelector('[data-action="queue-approval"][data-approval="inherit"]').click();const permissions=fullPermission&&queueTaskDraft.settings.approval==='inherit';
 const quota=state.quota;state.quota=structuredClone(quota);for(const bucket of state.quota.buckets){if(bucket.primary?.windowDurationMins===300)bucket.primary=null;if(bucket.secondary?.windowDurationMins===300)bucket.secondary=null;}
 queueTaskTab='quota';render(true);const hiddenFive=!!root.querySelector('fieldset.queue-period[hidden]')&&!root.querySelector('input[name=pool]:not([type=hidden])')&&quotaFromForm(document.getElementById('queue-task-editor')).pool==='codex';
 state.quota=quota;queueTaskTab='prompt';render(true);mergeQueueAttachments([image]);queueExpanded=false;render(true);await loadQueuePreviews(queueTaskDraft.settings.attachments);
 const rect=document.getElementById('queue-prompt').getBoundingClientRect(),main=document.querySelector('.main').getBoundingClientRect(),bounds=rect.left>=main.left&&rect.right<=main.right&&rect.bottom<=main.bottom;
 const centers=['.queue-attach-menu>summary','.queue-permission-menu>summary','.queue-model-trigger','.queue-submit'].map(selector=>{const r=root.querySelector(selector).getBoundingClientRect();return r.top+r.height/2;});
 const aligned=Math.max(...centers)-Math.min(...centers)<1;
 const attachmentsFirst=root.querySelector('.queue-attachment-grid').compareDocumentPosition(document.getElementById('queue-prompt'))&Node.DOCUMENT_POSITION_FOLLOWING;
 const composer=!!root.querySelector('.queue-submit svg')&&!!root.querySelector('.queue-attach-menu')&&!!root.querySelector('.queue-model-bolt svg')&&popover&&aligned&&!!attachmentsFirst&&!root.querySelector('.queue-model-trigger').textContent.includes('⌄');
 return {ok:permissions&&composer&&expanded&&pasted&&tiles&&modelPicked&&effort&&retained&&removed&&hiddenFive&&bounds,permissions,composer,expanded,pasted,tiles,modelPicked,effort,retained,removed,hiddenFive,bounds};
};

root.addEventListener('input',event=>{if(event.target.id==='outlook-start')qaOutlookStart=event.target.value;if(event.target.id==='outlook-end')qaOutlookEnd=event.target.value;});

window.__contextAppearanceSmoke=async()=>{
 selectChat('demo-a');await loadStats(true);
 const until=Date.now()+5000;while((statsLoading||stats?.threadId!=='demo-a')&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,20));
 render(true);
 const main=root.querySelector('.main'),events=root.querySelector('.events-plot');
 if(!events)return {ok:false,view,selected,detailsOpen,settingsOpen,statsLoading,statsThread:stats?.threadId,statsError,dragging,smoothingInteracting,plots:root.querySelectorAll('[data-plot]').length};
 main.scrollTop+=events.getBoundingClientRect().top-main.getBoundingClientRect().top-220;
 scrollEdges.refresh();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
 const markers=[...events.querySelectorAll('.event-marker')];
 const separated=markers.every((a,i)=>markers.slice(i+1).every(b=>{const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();return x.right<=y.left||y.right<=x.left||x.bottom<=y.top||y.bottom<=x.top;}));
 const changes=!!events.querySelector('.model[title*="→"]')&&!!events.querySelector('.effort[title*="→"]');
 const edges=[...document.querySelectorAll('.scroll-edge[data-surface="main"]:not([hidden])')];
 const fade=edges.length===2&&edges.every(edge=>getComputedStyle(edge).pointerEvents==='none'&&getComputedStyle(edge).backdropFilter.includes('blur')&&edge.getBoundingClientRect().height===14);
 return {ok:separated&&changes&&fade,separated,changes,fade,markers:markers.length};
};
window.__contextPricePreview=()=>{qaOutlookMetric='cost';qaOutlookOverlay=true;qaOutlookOverlayCount=6;qaPeriod='five';qaOutlookStart='';qaOutlookEnd='';qaOutlookRange=null;view='quota';render();root.querySelector('[data-qa-chart="outlook-cost-overlay-five"]')?.scrollIntoView({block:'center'});};

root.addEventListener('pointerdown',event=>{if(queueModelOpen&&!event.target.closest('.queue-model-popover')){queueModelOpen=false;const panel=root.querySelector('.queue-model-panel');if(panel)panel.hidden=true;root.querySelector('[data-action="queue-model-popup"]')?.setAttribute('aria-expanded','false');}});
root.addEventListener('keydown',event=>{if(event.key==='Escape'&&queueModelOpen){queueModelOpen=false;const panel=root.querySelector('.queue-model-panel');if(panel)panel.hidden=true;root.querySelector('[data-action="queue-model-popup"]')?.focus();}});

window.__contextComposerPreview=async kind=>{queueID=selected;openQueueTask();queueTaskDraft.prompt='完成这项任务，保留必要的验证结果。';if(kind==='full')queueTaskDraft.settings.approval='full';queueModelOpen=kind==='model';render(true);if(kind==='attachments'){const pasted=await api.invoke('queue-paste-image');mergeQueueAttachments([...pasted.attachments,{path:'C:\\fixtures\\notes.txt',name:'任务说明.txt',kind:'file'}]);await loadQueuePreviews(queueTaskDraft.settings.attachments);}if(kind==='full'){const menu=root.querySelector('.queue-permission-menu');if(menu)menu.open=true;}root.querySelector('.queue-composer-card')?.scrollIntoView({block:'center'});};

async function loadCloudSync(){try{cloudState=await api.invoke('cloud-sync',{action:'status'});if(settingsOpen&&settingsTab==='cloud'&&!document.activeElement?.closest('[data-cloud-accounts]'))render();}catch(error){notify(error.message);}}
async function pollCloudSync(){try{cloudState=await api.invoke('cloud-sync',{action:'status'});if(!settingsOpen||settingsTab!=='cloud')return;const holder=document.createElement('div');holder.innerHTML=cloudSyncView(cloudState,{e,t});const current=root.querySelector('[data-cloud-status]'),next=holder.querySelector('[data-cloud-status]');if(current&&next)current.replaceWith(next);
for(const region of ['data-cloud-accounts','data-cloud-devices']){
 const a=root.querySelector('['+region+']'),b=holder.querySelector('['+region+']');if(!a||!b)continue;
 if(a.contains(document.activeElement))continue;
 for(const input of a.querySelectorAll('[data-cloud-account-name]')){const match=[...b.querySelectorAll('[data-cloud-account-name]')].find(n=>n.dataset.cloudAccountName===input.dataset.cloudAccountName);if(match)match.value=input.value;}
 for(const attr of ['data-cloud-stat-account','data-cloud-sync-account','data-cloud-stat-device'])for(const input of a.querySelectorAll('['+attr+']')){
  const match=[...b.querySelectorAll('['+attr+']')].find(n=>n.getAttribute(attr)===input.getAttribute(attr));if(match)match.checked=input.checked;
 }
 a.replaceWith(b);
}
for(const action of ['cloud-save','cloud-run']){const a=root.querySelector(`[data-action="${action}"]`),b=holder.querySelector(`[data-action="${action}"]`);if(a&&b){a.disabled=b.disabled;a.textContent=b.textContent;}}}catch(error){notify(error.message);}}

window.__contextLoginSmoke=async({preview=false}={})=>{
  const wait=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(r=>setTimeout(r,20));}throw Error('Login manager smoke timeout');};
  openSettings('accounts');await wait(()=>root.querySelectorAll('[data-login-profile]').length===2);
  if(root.querySelectorAll('[data-login-quota] .sidebar-credits').length!==2||root.querySelectorAll('[data-login-quota] [data-quota-reset]').length!==4)throw Error('Account cards missing quota summaries');
  const first=root.querySelector('[data-login-name]');first.value='Work sign-in';first.focus();await pollLogins();if(!first.isConnected||first.value!=='Work sign-in')throw Error('Login polling replaced draft');
  root.querySelector(`[data-action="login-rename"][data-id="${first.dataset.loginName}"]`).click();await wait(()=>loginState?.profiles.some(p=>p.name==='Work sign-in'));
  root.querySelector('#login-name').value='Added sign-in';root.querySelector('[data-action="login-add"]').click();await wait(()=>loginState?.profiles.length===3);
  root.querySelector('[data-action="login-switch"][data-id="'+('b'.repeat(32))+'"]').click();await wait(()=>loginState?.activeId==='b'.repeat(32));
  const added=loginState.profiles.find(p=>p.name==='Added sign-in');root.querySelector(`[data-action="login-remove"][data-id="${added.id}"]`).click();await wait(()=>loginState?.profiles.length===2);
  closeSettings();render();const quick=root.querySelector('.sidebar-account-switch');if(!quick)throw Error('Missing sidebar quick switch');
  const nameStyle=getComputedStyle(root.querySelector('.sidebar-account-name'));if(Number(nameStyle.fontWeight)<600||parseFloat(nameStyle.lineHeight)<16)throw Error('Sidebar account label too small');
  quick.click();await wait(()=>loginState?.activeId===quick.dataset.id);openSettings('accounts');await pollLogins();
  const result={ok:!!root.querySelector('[data-action="login-embedded"]')&&!/access_token|refresh_token|authUrl/.test(root.innerHTML),accounts:loginState.profiles.length,switched:true,renamed:true,removed:true,quickSwitch:true,quotaSummary:true};
  if(!preview)closeSettings();return result;
};

window.__contextAccountsPreview=async()=>{openSettings('cloud');await loadCloudSync();root.querySelector('[data-cloud-accounts]')?.scrollIntoView({block:'start'});};

window.__contextAccountsSmoke=async()=>{
  const wait=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(r=>setTimeout(r,20));}throw Error('Account settings smoke timeout');};
  openSettings('cloud');await wait(()=>root.querySelectorAll('[data-cloud-account-name]').length===2);
  const input=root.querySelector('[data-cloud-account-name]'),id=input.dataset.cloudAccountName;
  input.value='Smoke work';input.focus();await pollCloudSync();if(document.activeElement!==input||input.value!=='Smoke work')throw Error('Polling replaced name draft');
  root.querySelector(`[data-action="cloud-account-rename"][data-id="${id}"]`).click();await wait(()=>cloudState?.accounts.find(a=>a.id===id)?.customName==='Smoke work');
  const toggle=root.querySelector('[data-cloud-quota-account]'),toggleId=toggle.dataset.cloudQuotaAccount;
  toggle.checked=false;toggle.dispatchEvent(new Event('change',{bubbles:true}));await wait(()=>state?.quota?.accounts.find(a=>a.scope==='account:'+toggleId)?.showQuota===false);
  closeSettings();render();if(root.querySelectorAll('.sidebar-account').length!==1)throw Error('Visibility did not hide account');
  openSettings('cloud');await wait(()=>root.querySelector('[data-cloud-quota-account]'));
  const restore=root.querySelector('[data-cloud-quota-account]');if(restore.checked)throw Error('Visibility not retained on reopen');restore.checked=true;restore.dispatchEvent(new Event('change',{bubbles:true}));await wait(()=>state?.quota?.accounts.find(a=>a.scope==='account:'+toggleId)?.showQuota===true);
  closeSettings();render();if(root.querySelectorAll('.sidebar-account').length!==2||!root.querySelector('.sidebar-account.current .sidebar-account-name').textContent.includes('Smoke work'))throw Error('Stack or account name mismatch');
  const active=root.querySelector('.sidebar-account.current .quota-outline-value'),inactive=root.querySelector('.sidebar-account.inactive .quota-outline-value');
  if(getComputedStyle(active).stroke===getComputedStyle(inactive).stroke)throw Error('Inactive components not muted');
  if(root.querySelectorAll('.sidebar-account [data-quota-reset]').length!==4)throw Error('Missing reset timestamps');
  return {ok:true,renamed:true,visibilityPersists:true,accounts:2,resetWindows:4};
};

window.__contextCloudSmoke=async({preview=false}={})=>{
  openSettings('general');root.querySelector('[data-action="settings-tab"][data-tab="cloud"]').click();const wait=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(r=>setTimeout(r,20));}throw Error('Cloud settings smoke timeout');};await wait(()=>root.querySelector('#cloud-provider'));
  root.querySelector('#cloud-device-name').value='Smoke workstation';root.querySelector('#cloud-statistics-mode').value='selected';
  const account=root.querySelector('[data-cloud-stat-account]'),syncAccount=root.querySelector('[data-cloud-sync-account]'),device=root.querySelector('[data-cloud-stat-device]');
  if(!account||!syncAccount||!device)throw Error('Account and device selectors missing');account.checked=false;syncAccount.checked=false;device.checked=false;
  await pollCloudSync();if(root.querySelector('[data-cloud-stat-account]').checked||root.querySelector('[data-cloud-stat-device]').checked)throw Error('Polling replaced unsaved selections');
  const provider=root.querySelector('#cloud-provider');provider.value='gist';provider.dispatchEvent(new Event('change',{bubbles:true}));
  if(root.querySelector('[data-cloud-gist]').hidden||!root.querySelector('[data-cloud-repository]').hidden)throw Error('Gist provider visibility');
  root.querySelector('#cloud-interval').value='-1';root.querySelector('#cloud-interval').dispatchEvent(new Event('change',{bubbles:true}));if(root.querySelector('[data-cloud-custom]').hidden)throw Error('Custom interval visibility');
  root.querySelector('#cloud-custom').value='17';root.querySelector('#cloud-token').value='smoke-token';root.querySelector('#cloud-key').value='a';root.querySelector('#cloud-gist').value='a'.repeat(32);root.querySelector('#cloud-enabled').checked=false;
  if(root.querySelector('[data-action="cloud-run"]').disabled)throw Error('Sync must be available on a disabled device');
  root.querySelector('[data-action="cloud-run"]').click();await wait(()=>cloudState?.hasKey&&cloudState.intervalMinutes===17&&cloudState.enabled);
  if(cloudState.deviceName!=='Smoke workstation'||cloudState.statisticsMode!=='selected'||cloudState.excludedAccounts.length!==1||cloudState.excludedSyncAccounts.length!==1||cloudState.excludedDevices.length!==1)throw Error('Account/device selections did not save');
  if(root.querySelector('#cloud-key').value||root.querySelector('#cloud-token').value)throw Error('Credentials retained in settings DOM');
  if(!root.querySelector('#cloud-token').placeholder.includes('•')||!root.querySelector('#cloud-key').placeholder.includes('•'))throw Error('Saved credentials must stay visibly masked');
  for(const field of ['token','key']){document.querySelector('#toast').textContent='';root.querySelector(`[data-action="cloud-copy"][data-field="${field}"]`).click();await wait(()=>document.querySelector('#toast').textContent===t(field==='token'?'Token 已复制':'同步密钥已复制'));}
  closeSettings();openSettings('cloud');await wait(()=>root.querySelector('#cloud-key'));if(!root.querySelector('#cloud-key').placeholder.includes('•'))throw Error('Credential mask lost on reopen');
  await wait(()=>cloudState?.lastSuccess);const result={ok:true,provider:cloudState.provider,customInterval:cloudState.intervalMinutes,credentialsRedacted:!root.querySelector('#cloud-key').value,maskedAfterReopen:root.querySelector('#cloud-key').placeholder.includes('•'),savedCopy:true};if(!preview)closeSettings();return result;
};

root.addEventListener('input',event=>{
  if(!event.target.id.startsWith('activation-'))return;
  activationDraft={notificationsEnabled:document.getElementById('activation-notifications').checked,creditsNotificationsEnabled:document.getElementById('activation-credits-notifications').checked,stopOnCreditsEnabled:document.getElementById('activation-credits-stop').checked,creditsTrigger:document.getElementById('activation-credits-trigger').value,weeklyEnabled:document.getElementById('activation-weekly').checked,toleranceMinutes:document.getElementById('activation-tolerance').value,scheduleMode:document.getElementById('activation-mode').value,scheduleTime:document.getElementById('activation-time').value};
  if(event.target.id==='activation-mode')render(true);
});
window.__contextActivationSmoke=async()=>{
  openSettings('activation');
  document.getElementById('activation-weekly').checked=true;
  document.getElementById('activation-credits-stop').checked=true;
  document.getElementById('activation-credits-trigger').value='either';
  document.getElementById('activation-credits-notifications').checked=false;
  document.getElementById('activation-mode').value='once';
  document.getElementById('activation-mode').dispatchEvent(new Event('input',{bubbles:true}));
  document.getElementById('activation-time').value='06:35';
  document.getElementById('activation-time').dispatchEvent(new Event('input',{bubbles:true}));
  root.querySelector('[data-action="activation-save"]').click();
  for(let i=0;i<150&&state?.quotaActivation?.config.scheduleMode!=='once';i++)await new Promise(r=>setTimeout(r,20));
  const tomorrowOnly=state?.quotaActivation?.config.scheduledAt===nextActivationAt('06:35',Date.now(),{tomorrow:true});
  document.getElementById('activation-mode').value='daily';
  document.getElementById('activation-mode').dispatchEvent(new Event('input',{bubbles:true}));
  root.querySelector('[data-action="activation-save"]').click();
  for(let i=0;i<150&&state?.quotaActivation?.config.scheduleMode!=='daily';i++)await new Promise(r=>setTimeout(r,20));
  const saved=state?.quotaActivation?.config;
  openSettings('activation');
  const persisted=document.getElementById('activation-mode').value==='daily'&&document.getElementById('activation-time').value==='06:35';
  const toggle=document.getElementById('activation-weekly');
  // Sample the actual transition endpoints even when CI throttles a hidden window.
  const switchPosition=checked=>{
    toggle.checked=checked;getComputedStyle(toggle,'::before').transform;
    for(const animation of toggle.getAnimations({subtree:true}))animation.finish();
    const transform=getComputedStyle(toggle,'::before').transform;
    return transform==='none'?0:new DOMMatrixReadOnly(transform).m41;
  };
  const onPosition=switchPosition(true),offPosition=switchPosition(false);toggle.checked=true;
  const slidingSwitch=toggle.getAttribute('role')==='switch'&&getComputedStyle(toggle).appearance==='none'&&Math.abs(onPosition-16)<.1&&Math.abs(offPosition)<.1;
  const creditsPersisted=saved?.stopOnCreditsEnabled===true&&saved?.creditsTrigger==='either'&&saved?.creditsNotificationsEnabled===false&&document.getElementById('activation-credits-stop').checked&&document.getElementById('activation-credits-trigger').value==='either'&&!document.getElementById('activation-credits-notifications').checked;
  const ok=creditsPersisted&&saved?.weeklyEnabled===true&&saved?.scheduledAt===nextActivationAt('06:35',Date.now())&&tomorrowOnly&&persisted&&!!root.querySelector('[data-activation-recommendation]')&&slidingSwitch;
  return {ok,saved,tomorrowOnly,persisted,creditsPersisted,slidingSwitch,onPosition,offPosition};
};

async function pollLogins(){try{const next=await api.invoke('account-switch',{action:'status'}),changed=JSON.stringify(next)!==loginRendered;loginState=next;if(changed&&settingsOpen&&settingsTab==='accounts'&&!document.activeElement?.matches('input'))render();}catch(error){notify(error.message);}}
