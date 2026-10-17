import {threadDraft as legacyThreadDraft,draftLimits as legacyDraftLimits,resizeDraft as legacyResizeDraft,policyForDraft as legacyPolicyForDraft} from '../../src/ui-budget.mjs';
import {appleThreadDraft,appleDraftLimits,appleResizeDraft,applePolicyForDraft,windowConfirmed,observedWindowTitle,modelDisplayName} from '../../src/apple-ui.mjs';
import {tokenNumber} from '../../src/policy.mjs';
import {savedBudget} from '../../src/budget.mjs';
import {timelineData,nearestBucket} from '../../src/timeline-data.mjs';
import {translate} from '../../src/localization-core.mjs';
import {trayState} from '../../src/tray-state.mjs';
import {timelinePlot,timelineX,timelinePosition} from '../../src/timeline-scale.mjs';
import {DEFAULT_SHORTCUT,shortcutLabel,shortcutFromEvent,normalizeShortcut} from '../../src/ui-shortcut.mjs';
import {sliderMotion} from '../../src/slider-motion.mjs';
import {selectedQuota,quotaWindows,quotaStale} from '../../src/quota-display.mjs';
import {budgetView,chatView,detailsView,statisticsView,chartDetailView,rawRecordsView,trayChatView} from './apple-view.mjs';

const api=window.contextManager,root=document.querySelector('#app'),mode=new URLSearchParams(location.search).get('mode')||'main';
let state=null,preferences={language:'zh',selection:'auto',english:{}},selected=null,view='chat',draft=null,dirty=false,dragging=false,busy=false,stats=null,statsJSON='',timeline=null,period=0,hover=null,pinned=null,page=0,auto=true,lastStats=0,toastTimer,refreshing=false,interactionId=null;
let shortcutDraft=DEFAULT_SHORTCUT,shortcutEnabled=true,shortcutRecording=false,shortcutDirty=false;
let settingsOpen=false,settingsTab='general',settingsSnapshot=null,settingsUnderlay='';
let integrationError='',integrationPending=false;
let detailsOpen=false,detailsSnapshot=null,detailsUnderlay='',statsLoading=false,statsError='',rawSelectedID=null,lastDetailBucket=null,smoothingTimer,deferredStats=null;
let mainNotice='',mainNoticeError=false;
let budgetInputError='',detailsEpoch=0,serviceAvailable=false,smoothingInteracting=false;
let budgetText={};
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
const trayDrafts=new Map();
let sidebarWidth=Number(localStorage.getItem('sidebar-width'))||270;
const visibleSidebarWidth=()=>Math.max(235,Math.min(sidebarWidth,340,window.innerWidth-650));
const e=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
function t(zh,en,...args){const translated=translate(zh,preferences.english,preferences.language);let value=preferences.language==='zh'?zh:translated===zh?(en||zh):translated;return String(value??'').replace(/\{(\d+)\}/g,(_,n)=>String(args[n]??''));}
const amount=value=>value==null?'—':Number(value).toLocaleString(preferences.language==='zh'?'zh-CN':'en-US',{maximumFractionDigits:1});
const k=value=>value==null?'—':value>=1000000?(value/1000000).toFixed(2).replace(/\.?0+$/,'')+'M':value>=1000?Number((value/1000).toFixed(1))+'K':amount(value);
const money=value=>value==null?'—':'$'+Number(value).toFixed(2);
const tokens=value=>value==null?t('待观测','Unobserved'):amount(value)+' tokens';
const current=()=>state?.threads.find(t=>t.id===selected);
const phaseNames={extension_pending:['等待重开 Codex','Restart Codex'],compacting:['正在保护性压缩','Compacting'],confirmed:['窗口已确认','Window confirmed'],awaiting_runtime_confirmation:['等待下一轮确认','Awaiting next-turn confirmation'],reloading:['正在应用','Applying'],waiting_for_idle:['等待轮次结束','Waiting for turn end'],queued:['等待轮次结束','Queued'],needs_compaction:['需要先压缩','Compaction needed'],needs_observation:['等待用量记录','Waiting for usage'],error:['需要处理','Needs attention'],mismatch:['需要处理','Readback mismatch'],saved:['已保存','Saved']};
const phase=thread=>{const names=phaseNames[thread?.phase];return names?t(...names):t('尚未接入','Not connected');};
function notify(message){const node=document.querySelector('#toast');node.textContent=t(message);node.style.display='block';clearTimeout(toastTimer);toastTimer=setTimeout(()=>node.style.display='none',6500);}
async function run(action,params={},message){if(busy)return;busy=true;document.body.classList.add('busy');try{const result=await api.invoke(action,params);if(message)notify(message);return result;}catch(error){notify(error.message);throw error;}finally{busy=false;document.body.classList.remove('busy');}}
function observed(thread){return thread?.observedWindow>0&&thread.lastUsage?.totalTokens!=null?Math.max(0,thread.lastUsage.totalTokens/thread.observedWindow):null;}
function ring(thread){const fraction=observed(thread);return `<span class="ring" style="--fraction:${Math.min(1,fraction??0)}" aria-hidden="true"><i></i></span>`;}
function statusText(thread){return thread.connected?phase(thread):t(thread.lastUsage?'已缓存':'本地聊天',thread.lastUsage?'Cached':'Local chat');}
function sidebar(){
  const connected=state?.bridgeCount>0;
  return `<aside class="sidebar"><div class="brand row"><span class="dot ${connected?'on':''}"></span><span>Codex</span>${preferences.demo?`<span class="preview-pill">${e(t('预览','Preview'))}</span>`:''}<span class="grow"></span><span class="tiny">v${e(preferences.version||'')}</span></div><nav class="chat-list" aria-label="${e(t('聊天','Chats'))}">${(state?.threads||[]).map(chat=>`<button class="chat-button ${selected===chat.id&&view!=='defaults'?'selected':''}" data-action="select" data-id="${e(chat.id)}" title="${e(chatName(chat))}"><span class="truncate">${e(chatName(chat))}</span><span class="muted">${e(statusText(chat))}</span></button>`).join('')||`<p class="muted tiny">${e(t('等待本地聊天…','Waiting for local chats…'))}</p>`}</nav><button class="settings-trigger" data-action="settings" title="${e(t('设置','Settings'))}" aria-label="${e(t('设置','Settings'))}" aria-haspopup="dialog" aria-expanded="${settingsOpen}"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m9.5 3-.7 2.2-2 .9-2.1-.5-2.5 4.3 1.5 1.7v2.3l-1.5 1.7 2.5 4.3 2.1-.5 2 .9.7 2.2h5l.7-2.2 2-.9 2.1.5 2.5-4.3-1.5-1.7v-2.3l1.5-1.7-2.5-4.3-2.1.5-2-.9-.7-2.2Z"/><circle cx="12" cy="12.8" r="3"/></svg></button></aside>`;
}
function slider(value,model,{single=false,id='main'}={}){
  const limit=draftLimits(model,value.window,value.reserve),max=limit?.maximum||1,white=value.window/max*100,blue=value.compact/max*100;
  const maxMode=model.context_ceiling===920000&&value.window===920000;
  return `<div class="slider" data-slider="${e(id)}" data-single="${single}" style="--motion-duration:${sliderMotion(value,max).duration.toFixed(3)}s"><div class="track"><div class="fill ${maxMode?'max-flow':''}" style="width:${single?white:blue}%"></div>${single?'':`<div class="headroom-fill" style="left:${blue}%;width:${Math.max(0,white-blue)}%"></div>`}<span class="particles">${single?'':particleMarkup(value,max)}</span></div>${single?'':`<i class="thumb compact ${interactionId==='compact'?'selected':''}" style="left:${blue}%"></i>`}<i class="thumb ${interactionId!=='compact'?'selected':''}" style="left:${white}%"></i>${single?'':`<input class="a11y-range" data-range="compact" aria-label="${e(t('压缩触发','Compression trigger'))}" aria-valuetext="${k(value.compact)}" type="range" min="1000" max="${Math.max(1000,limit.compact)}" step="1000" value="${value.compact}">`}<input class="a11y-range" data-range="window" aria-label="${e(t('上下文窗口','Context window'))}" aria-valuetext="${k(value.window)}" type="range" min="${single?2000:1000}" max="${max}" step="1000" value="${value.window}"><span class="keyboard-focus">${e(t('使用左右方向键调节','Use arrow keys to adjust'))}</span></div>`;
}
// Keep random profiles and a focus-aware clock across automatic DOM refreshes.
// CSS animates every frame; JS only sets up particles when controls change.
const particleProfiles=[];
const particleClock={elapsed:0,at:performance.now(),running:!document.hidden&&document.hasFocus()};
function particleTime(){return particleClock.elapsed+(particleClock.running?performance.now()-particleClock.at:0);}
function particleStyle(index,motion){
  const p=particleProfiles[index]??=({phase:Math.random(),pace:.85+Math.random()*.6,top:4+Math.random()*15,size:1.7+Math.random()*1.4,opacity:.3+Math.random()*.5,sway:5+Math.random()*9,driftA:-3+Math.random()*6,driftB:-3+Math.random()*6});
  const duration=motion.duration*p.pace;
  return `--particle-duration:${duration.toFixed(3)}s;--particle-delay:-${(p.phase*duration).toFixed(3)}s;--drift-duration:${p.sway.toFixed(3)}s;--drift-delay:-${(p.phase*p.sway).toFixed(3)}s;--particle-opacity:${p.opacity.toFixed(3)};--drift-a:${p.driftA.toFixed(2)}px;--drift-b:${p.driftB.toFixed(2)}px;top:${p.top.toFixed(2)}px;width:${p.size.toFixed(2)}px;height:${p.size.toFixed(2)}px`;
}
function syncParticleTime(slider){
  const time=particleTime();
  for(const node of slider.querySelectorAll('.particles i,.max-flow'))for(const animation of node.getAnimations())animation.currentTime=time;
}
function particleMarkup(value,maximum){
  const motion=sliderMotion(value,maximum);
  return Array.from({length:motion.count},(_,i)=>`<i style="${particleStyle(i,motion)}"></i>`).join('');
}
function updateParticles(slider,value,maximum){
  const motion=sliderMotion(value,maximum);slider.style.setProperty('--motion-duration',motion.duration.toFixed(3)+'s');
  const particles=slider.querySelector('.particles');if(!particles||slider.dataset.single==='true')return;
  while(particles.children.length<motion.count)particles.append(document.createElement('i'));
  while(particles.children.length>motion.count)particles.lastElementChild.remove();
  for(const [i,particle]of [...particles.children].entries())particle.style.cssText=particleStyle(i,motion);
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
  if(chat&&!previewError){try{if(!draft)throw Error('等待当前模型的原生窗口信息');applePolicyForDraft(draft,chat.modelMetadata);}catch(error){previewError=error.message;}}
  return chatView({chat:chat?{...chat,name:chatName(chat)}:null,draft,budget:savedBudget(chat?.policy,chat?.modelMetadata),confirmed:windowConfirmed(chat),observedTitle:observedWindowTitle(chat),modelName:modelDisplayName(chat?.model||''),canEdit:!!draft&&chat?.modelMetadata?.context_catalog_ready!==false,previewError,budgetCard,notice:mainNotice,noticeError:mainNoticeError,e,t,tokens});
}

function defaultModel(){const l=state?.newChatDefaultsLimits;return l?{max_context_window:Math.ceil(l.maximumUsableWindow*100/l.effectivePercent),effective_context_window_percent:l.effectivePercent,...(l.extended?{context_ceiling:920000,context_compact_ceiling:904000}:{})}:null;}
function defaultsPage(){return `<div class="content"><div><h1>${e(t('全局默认','Global defaults'))}</h1><p class="muted">${e(t('只影响之后创建的新聊天；分支继续继承父聊天预算。','Only affects new chats. Forks continue to inherit their parent budget.'))}</p></div>${budgetCard(draft,defaultModel(),{defaults:true})}<div class="actions"><button class="primary" data-action="save-defaults" ${!draft?'disabled':''}>${e(t('保存默认值','Save defaults'))}</button><button data-action="copy-current" ${!current()?'disabled':''}>${e(t('使用当前聊天设置','Use current chat settings'))}</button><button class="flat" data-action="reload">${e(t('取消','Cancel'))}</button></div>${state.newChatDefaultsPending?`<div class="state-card">${e(t('已有连接需要重开 Codex 才能加载新聊天默认功能。','Restart Codex to load defaults support in older connections.'))}</div>`:''}</div>`;}
function setNotice(message,error=false){mainNotice=message||'';mainNoticeError=error;const node=document.getElementById('main-notice');if(node){node.textContent=t(mainNotice);node.classList.toggle('error',error);node.classList.toggle('muted',!error);}}
function refreshBudgetValidity(){
  if(editingDefaults()||mode==='tray')return;
  let error=budgetInputError;try{if(!error){if(!draft)throw Error('等待当前模型的原生窗口信息');applePolicyForDraft(draft,current()?.modelMetadata);}}catch(failure){error=failure.message;}
  const fieldset=editorRoot()?.querySelector('.budget-editor');if(fieldset)fieldset.disabled=!draft||current()?.modelMetadata?.context_catalog_ready===false;
  const node=editorRoot()?.querySelector('#budget-error');if(node){node.textContent=t(error||'');node.hidden=!error;}
  for(const action of ['apply','preflight']){const button=editorRoot()?.querySelector(`[data-action="${action}"]`);if(button)button.disabled=!!error||!draft;}
}
function openDetails(){
  if(!current())return;
  detailsSnapshot={draft:draft?{...draft}:null,dirty,scroll:root.querySelector('.main')?.scrollTop||0};detailsUnderlay=root.querySelector('.main')?.innerHTML||'';
  detailsOpen=true;detailsEpoch++;view='stats';stats=null;statsJSON='';statsError='';statsLoading=false;deferredStats=null;rawSelectedID=null;lastDetailBucket=null;hover=pinned=null;page=0;auto=true;
  render();document.getElementById('details-close')?.focus();void loadStats(true);
}
function closeDetails(){
  if(!detailsOpen)return;const snapshot=detailsSnapshot;
  detailsOpen=false;smoothingInteracting=false;detailsEpoch++;view='chat';statsLoading=false;deferredStats=null;hover=pinned=null;clearTimeout(smoothingTimer);
  if(snapshot){draft=snapshot.draft;dirty=snapshot.dirty;}detailsSnapshot=null;detailsUnderlay='';if(!dirty)loadDraft();render();
  if(snapshot)root.querySelector('.main').scrollTop=snapshot.scroll;root.querySelector('[data-action="stats"]')?.focus();
}
function acceptStats(result){const json=JSON.stringify(result);if(json===statsJSON)return false;statsJSON=json;stats=result;return true;}
function applyDeferredStats(){if(deferredStats&&detailsOpen&&hover==null&&!smoothingInteracting){const result=deferredStats;deferredStats=null;if(acceptStats(result))render();}}
function trayEdited(value){return !!value&&(value.window!==value.baseWindow||value.compact!==value.baseCompact);}
function trayChanged(value){return !!value&&(trayEdited(value)||!value.baseEnabled);}
function trayTarget(chat,value){
  if(trayFeedback.has(chat.id))return trayFeedback.get(chat.id).message;
  if(chat.observedWindow!=null&&Math.floor(chat.observedWindow/1000)!==Math.floor(value.window/1000))return t('目标 {0}K · {1} {2}K','Target {0}K · {1} {2}K',Math.floor(value.window/1000),chat.connected&&chat.freshUsage?t('实际','Actual'):t('上次','Last'),Math.floor(chat.observedWindow/1000));
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
function render(){
  if(mode==='tray'){renderTray();return;}
  if(!settingsOpen&&shortcutRecording)finishShortcutRecording();
  const oldMain=root.querySelector('.main'),same=oldMain?.dataset.view===view,open=same?[...oldMain.querySelectorAll('details')].map((d,i)=>d.open?i:-1).filter(i=>i>=0):[],scroll=same?oldMain.scrollTop:0;
  const settingsScroll=root.querySelector('.settings-body')?.scrollTop||0;
  const detailScroll=root.querySelector('.details-body')?.scrollTop||0,disclosures=[...root.querySelectorAll('.details-dialog details[open]')].map(node=>node.dataset.disclosure),focusID=document.activeElement?.closest('.details-dialog')?document.activeElement.id:null;
  const body=settingsOpen?settingsUnderlay:detailsOpen?detailsUnderlay:`${preferences.demo?demoBanner():''}${editingDefaults()?defaultsPage():chatPage()}`;
  root.innerHTML=`<div class="shell" style="--sidebar-width:${visibleSidebarWidth()}px" ${settingsOpen||detailsOpen?'inert':''}>${sidebar()}<main class="main" id="main-content" data-view="${view}">${body}</main></div>${settingsOpen?settingsDialog():detailsOpen?detailsDialog():''}`;
  const newMain=root.querySelector('.main');for(const [i,d]of [...newMain.querySelectorAll('details')].entries())if(open.includes(i))d.open=true;newMain.scrollTop=detailsOpen?(detailsSnapshot?.scroll||0):scroll;
  if(newMain.querySelector('#phase')){newMain.querySelector('#phase').textContent=phase(current());newMain.querySelector('#phase-message').textContent=t(current()?.message||'接入后，设置会在轮次之间应用。');}
  if(settingsOpen)root.querySelector('.settings-body').scrollTop=settingsScroll;
  if(detailsOpen){for(const node of root.querySelectorAll('.details-dialog details'))if(disclosures.includes(node.dataset.disclosure))node.open=true;root.querySelector('.details-body').scrollTop=detailScroll;}
  bindSliders();bindSidebar();if(detailsOpen&&stats)drawCharts();
  if(focusID)document.getElementById(focusID)?.focus({preventScroll:true});
}
function demoBanner(){return `<div class="demo-banner row between"><div><strong>${e(t('合成数据预览 · 3 个示例聊天','Preview · 3 sample chats'))}</strong><p class="tiny">${e(t('这里不读取真实聊天；切换到本地模式可查看你的聊天。','Preview does not read real chats. Switch to local mode to see your chats.'))}</p></div><button class="small" data-action="open-live">${e(t('查看真实聊天','View real chats'))} ↗</button></div>`;}
function integrationSettings(){
  const integration=preferences.integration||{enabled:false,available:false};
  return `<section class="card stack"><h2>${e(t('Codex 接入','Codex integration'))}</h2><div class="state-card">${e(integrationPending?t('正在检查启动链…','Checking startup…'):integration.enabled?t('已启用；下次重开 Codex 后生效','Enabled; takes effect after restarting Codex'):t('已关闭','Disabled'))}</div><p class="muted">${e(t('安装时默认接入 Codex，可在这里关闭。查看本地聊天无需保持接入。','Installation enables Codex integration by default. You can disable it here; local chat browsing still works.'))}</p><p class="tiny muted">${e(t('实时预算控制需要接入。启用会登记启动入口和统计 Hook；关闭后恢复原启动配置，均在下次重开 Codex 后生效。','Live budget control needs integration. Enabling registers the launcher and statistics hook; disabling restores startup. Restart Codex for either change to take effect.'))}</p><div class="row wrap"><button class="${integration.enabled?'':'primary'}" data-action="integration-toggle" ${busy||integrationPending||!integration.available||preferences.demo?'disabled':''}>${e(integration.enabled?t('关闭接入','Disable integration'):t('手动启用接入','Enable integration manually'))}</button></div>${preferences.demo?`<p class="tiny muted">${e(t('预览模式不修改 Codex 启动配置。','Preview does not change Codex startup.'))}</p>`:''}${integrationError||integration.error?`<p class="error tiny" role="alert">${e(integrationError||integration.error)}</p>`:''}<div class="row"><button data-action="open-logs">${e(t('打开接入日志','Open integration logs'))}</button></div><p class="integration-log-note">${e(t('日志记录启动阶段、耗时和收发字节数，不记录聊天正文。','Logs record startup stages, timing and byte counts, without chat content.'))}</p></section>`;
}
function shortcutSettings(){
  const shortcut=preferences.shortcut||{accelerator:DEFAULT_SHORTCUT,enabled:true},status=!shortcut.enabled?t('已关闭','Disabled'):shortcut.inactive?t('当前未注册系统快捷键','System shortcut not registered'):shortcut.registered?t('快捷键已生效','Shortcut active'):t(shortcut.error||'快捷键尚未注册','Shortcut is not registered');
  return `<div class="content"><section class="card stack"><div class="row between"><h2>${e(t('显示 / 隐藏主窗口','Show / hide main window'))}</h2><label class="row tiny"><span>${e(t('启用全局快捷键','Enable global shortcut'))}</span><input id="shortcut-enabled" class="switch" type="checkbox" ${shortcutEnabled?'checked':''}></label></div><p class="muted">${e(t('默认 Ctrl + Shift + M：按一次显示，再按一次隐藏，可自定义。','Default: Ctrl + Shift + M. Press to show or hide; the shortcut is customizable.'))}</p><label class="stack tiny" for="shortcut-input">${e(t('快捷键','Shortcut'))}<input id="shortcut-input" type="text" class="shortcut-input ${shortcutRecording?'recording':''}" value="${e(shortcutRecording?t('按下组合键…','Press a key combination…'):shortcutLabel(shortcutDraft))}" ${shortcutRecording?'readonly':''} spellcheck="false" autocomplete="off"></label><div class="row wrap"><button data-action="shortcut-record">${e(shortcutRecording?t('取消录制','Cancel recording'):t('录制快捷键','Record shortcut'))}</button><button data-action="shortcut-reset">${e(t('恢复默认','Restore default'))}</button><span class="grow"></span><button class="primary" data-action="shortcut-save">${e(t('保存设置','Save settings'))}</button></div><div class="state-card ${shortcut.error?'error':''}" role="status">${e(status)}</div><p class="tiny muted">${e(t('可直接输入 Ctrl+Alt+K 等组合，或录制按键。按 Esc 取消录制。','Type a combination such as Ctrl+Alt+K, or record it. Press Esc to cancel recording.'))}</p><p class="tiny muted">${e(t('管理器驻留系统托盘时生效；完全退出后不再响应。','Works while the manager is running in the system tray. It stops when the manager exits.'))}</p>${preferences.demo?`<p class="tiny demo-notice">${e(t('预览设置与真实模式分开；请在真实模式中保存常用快捷键。','Preview preferences are separate. Save your shortcut in local mode for regular use.'))}</p>`:''}</section></div>`;
}
function quotaPanel(compact=false){
  const quota=state?.quota,buckets=quota?.buckets||[],bucket=selectedQuota(quota,preferences.quotaPool),windows=quotaWindows(bucket),stale=quotaStale(quota);
  const period=window=>{const minutes=window.windowDurationMins;return !minutes?t('额度周期','Quota period'):minutes%1440===0?t('{0}天','{0} days',minutes/1440):minutes%60===0?t('{0}小时','{0} hours',minutes/60):t('{0}分钟','{0} minutes',minutes);};
  return `<section class="quota-panel ${compact?'compact':'card stack'}"><div class="row between"><h2>${e(t('账户额度','Account quota'))}</h2><button class="small" data-action="quota-refresh" ${busy||quota?.loading?'disabled':''} aria-label="${e(t('刷新额度','Refresh quota'))}">↻ ${e(t('刷新','Refresh'))}</button></div>${buckets.length>1?`<label class="stack tiny" for="quota-pool">${e(t('额度类型','Quota pool'))}<select id="quota-pool">${buckets.map(item=>`<option value="${e(item.id)}" ${item.id===bucket?.id?'selected':''}>${e(item.name)}</option>`).join('')}</select></label>`:''}${windows.map(window=>`<div class="quota-window"><div class="row between"><span class="muted">${e(period(window))}</span><strong class="num ${window.remainingPercent<=20?'error':''}">${e(t('剩余 {0}%','{0}% remaining',Math.round(window.remainingPercent)))}</strong></div><div class="quota-meter"><i style="width:${Math.max(0,Math.min(100,window.remainingPercent))}%"></i></div><div class="tiny muted">${e(window.resetsAt?t('重置：{0}','Resets: {0}',new Date(window.resetsAt*1000).toLocaleString(preferences.language==='zh'?'zh-CN':'en-US')):t('重置时间暂不可用','Reset time unavailable'))}</div></div>`).join('')||`<p class="tiny muted">${e(quota?.loading?t('正在读取额度…','Reading quota…'):t(quota?.error||'额度暂不可用','Quota unavailable'))}</p>`}${bucket?.hasCredits||bucket?.unlimitedCredits?`<p class="tiny muted">${e(t('额外额度可用','Extra credits available'))}</p>`:''}${stale&&windows.length?`<span class="tiny error">${e(t('上次记录，待刷新','Cached observation; refresh needed'))}</span>`:''}${compact?'':`<p class="tiny muted">${e(t('通过官方运行时读取，每五分钟缓存刷新；不创建聊天或生成模型回复。','Read through the official runtime and cached for five minutes, without creating chats or model output.'))}</p>`}</section>`;
}
function generalSettings(){
  const ext=state?.contextExtension,u=state?.update||{};
  return `<section class="card stack"><h2>${e(t('通用','General'))}</h2><label class="stack tiny" for="language">${e(t('语言','Language'))}<select id="language"><option value="auto" ${preferences.selection==='auto'?'selected':''}>${e(t('自动（按时区）','Automatic (time zone)'))}</option><option value="zh" ${preferences.selection==='zh'?'selected':''}>中文</option><option value="en" ${preferences.selection==='en'?'selected':''}>English</option></select></label><div class="row wrap"><button data-action="scan">↻ ${e(t('同步本地聊天','Sync local chats'))}</button><button data-action="open-codex">↗ ${e(t('打开 Codex','Open Codex'))}</button></div><div class="extension"><div class="row between"><span>${e(t('拓展上下文','Extended context'))}</span><input type="checkbox" id="extension" class="switch" aria-label="${e(t('拓展上下文','Extended context'))}" ${ext?.enabled?'checked':''} ${!ext?.available||!ext?.compatible?'disabled':''}></div><p class="tiny muted">${e(t(ext?.message||'等待 Codex 连接','Waiting for Codex'))}</p></div><div class="row wrap"><button data-action="update" ${['downloading','installing'].includes(u.phase)?'disabled':''}>↓ ${e(['downloading','installing'].includes(u.phase)?t('正在更新…','Updating…'):u.available?t('安装更新 {0}','Install update {0}',u.version):t('检查更新','Check for updates'))}</button><span class="tiny muted">v${e(preferences.version||'')}</span></div>${u.error?`<span class="tiny error" role="status">${e(t(u.error))}</span>`:''}<div class="row wrap"><button data-action="diagnostics">${e(t('诊断','Diagnostics'))}</button><button data-action="open-logs">${e(t('打开接入日志','Open integration logs'))}</button></div><div class="feature-note"><strong>${e(t('提前压缩修复','Early compaction fix'))}</strong><p class="tiny muted">${e(t('上游已停用此旧版补丁，Windows 不提供该开关。原生自动压缩与聊天页的压缩触发阈值仍可使用。','The legacy patch is disabled upstream and unavailable on Windows. Native automatic compaction and per-chat thresholds remain available.'))}</p></div></section>`;
}
function settingsDialog(){
  const tabs=[['general',t('通用','General')],['defaults',t('全局默认','Global defaults')],['quota',t('账户额度','Account quota')],['integration',t('Codex 接入','Codex integration')],['shortcut',t('快捷键','Shortcut')]];
  const content=settingsTab==='general'?generalSettings():settingsTab==='defaults'?(state?defaultsPage():''):settingsTab==='quota'?quotaPanel():settingsTab==='integration'?integrationSettings():shortcutSettings();
  return `<div class="settings-backdrop" data-action="settings-dismiss"><section class="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title"><header class="settings-header row between"><h1 id="settings-title">${e(t('设置','Settings'))}</h1><button class="settings-close flat" data-action="settings-close" aria-label="${e(t('关闭设置','Close settings'))}">×</button></header><nav class="settings-tabs" role="tablist" aria-label="${e(t('设置分类','Settings sections'))}">${tabs.map(([id,label])=>`<button role="tab" id="settings-tab-${id}" aria-controls="settings-panel" aria-selected="${id===settingsTab}" class="${id===settingsTab?'active':''}" data-action="settings-tab" data-tab="${id}">${e(label)}</button>`).join('')}</nav><div class="settings-body" id="settings-panel" role="tabpanel" aria-labelledby="settings-tab-${settingsTab}">${content}</div></section></div>`;
}
function openSettings(tab='general'){
  if(detailsOpen)closeDetails();
  if(!settingsOpen){settingsSnapshot={draft:draft?{...draft}:null,dirty};settingsUnderlay=root.querySelector('.main')?.innerHTML||'';}
  if(shortcutRecording)finishShortcutRecording();
  settingsOpen=true;settingsTab=tab;hover=pinned=null;
  shortcutDraft=preferences.shortcut?.accelerator||DEFAULT_SHORTCUT;shortcutEnabled=preferences.shortcut?.enabled!==false;shortcutDirty=false;
  if(tab==='defaults')loadDraft();render();root.querySelector('.settings-close')?.focus();
}
function closeSettings(){
  if(shortcutRecording)finishShortcutRecording();settingsOpen=false;
  if(settingsSnapshot){draft=settingsSnapshot.draft;dirty=settingsSnapshot.dirty;}
  settingsSnapshot=null;settingsUnderlay='';if(!dirty)loadDraft();render();root.querySelector('.settings-trigger')?.focus();
}
function switchSettingsTab(tab){
  if(!['general','defaults','quota','integration','shortcut'].includes(tab))return;
  if(shortcutRecording)finishShortcutRecording();
  settingsTab=tab;
  if(tab==='defaults')loadDraft();else if(settingsSnapshot){draft=settingsSnapshot.draft;dirty=settingsSnapshot.dirty;}
  render();root.querySelector('.settings-body').scrollTop=0;root.querySelector(`[data-tab="${tab}"]`)?.focus();
}
function finishShortcutRecording(){shortcutRecording=false;api.invoke('shortcut-recording',{active:false}).catch(()=>{});const field=document.getElementById('shortcut-input');if(field){field.readOnly=false;field.value=shortcutLabel(shortcutDraft);field.classList.remove('recording');}const button=root.querySelector('[data-action="shortcut-record"]');if(button)button.textContent=t('录制快捷键','Record shortcut');}
function bindSidebar(){
  const side=root.querySelector('.sidebar');if(!side||side.querySelector('.sidebar-resizer'))return;
  const handle=document.createElement('div');handle.className='sidebar-resizer';handle.tabIndex=0;handle.setAttribute('role','separator');handle.setAttribute('aria-orientation','vertical');handle.setAttribute('aria-label',t('调整侧栏宽度','Resize sidebar'));side.append(handle);
  const apply=value=>{sidebarWidth=Math.max(235,Math.min(340,value));root.querySelector('.shell')?.style.setProperty('--sidebar-width',visibleSidebarWidth()+'px');handle.setAttribute('aria-valuenow',String(visibleSidebarWidth()));localStorage.setItem('sidebar-width',String(sidebarWidth));};
  handle.setAttribute('aria-valuemin','235');handle.setAttribute('aria-valuemax','340');handle.setAttribute('aria-valuenow',String(visibleSidebarWidth()));
  handle.addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();dragging=true;handle.setPointerCapture(event.pointerId);});
  handle.addEventListener('pointermove',event=>{if(handle.hasPointerCapture(event.pointerId))apply(event.clientX);});
  handle.addEventListener('pointerup',event=>{if(handle.hasPointerCapture(event.pointerId)){apply(event.clientX);handle.releasePointerCapture(event.pointerId);}dragging=false;});handle.addEventListener('pointercancel',()=>dragging=false);
  handle.addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();apply(event.key==='Home'?235:event.key==='End'?340:sidebarWidth+(event.key==='ArrowLeft'?-10:10));}});
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
    editor.querySelector('#compact-ratio').textContent=amount(ratio)+'%';
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
    const id=slider.dataset.slider,single=slider.dataset.single==='true';let target=null;
    const data=()=>id==='main'?{value:draft,model:editingDefaults()?defaultModel():current()?.modelMetadata}: {value:trayDrafts.get(id),model:state.threads.find(t=>t.id===id)?.modelMetadata};
    const move=event=>{const {value,model}=data();if(!value||!model)return;const rect=slider.getBoundingClientRect(),maximum=draftLimits(model,value.window,value.reserve).maximum,n=Math.round(Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width))*maximum/1000)*1000;
      if(!target){target=single?'window':Math.abs(n-value.compact)<Math.abs(n-value.window)?'compact':Math.abs(n-value.compact)===Math.abs(n-value.window)?interactionId||'window':'window';}
      if(id==='main')setDraft(target,n,model);else{const next=resizeDraft(value,Math.max(2000,Math.min(maximum,n)),model);trayDrafts.set(id,next);updateTrayDraft(id,next,model);}
    };
    slider.addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();dragging=true;if(mode==='tray')api.invoke('interaction',{dragging:true});target=null;slider.setPointerCapture(event.pointerId);slider.closest('.tray-row')?.classList.add('editing');move(event);});
    let pending=null,frame=null;
    slider.addEventListener('pointermove',event=>{if(!dragging||!slider.hasPointerCapture(event.pointerId))return;pending=event;if(frame==null)frame=requestAnimationFrame(()=>{frame=null;if(pending)move(pending);pending=null;});});
    const end=event=>{if(!slider.hasPointerCapture(event.pointerId))return;if(frame!=null)cancelAnimationFrame(frame);frame=null;pending=null;move(event);slider.releasePointerCapture(event.pointerId);dragging=false;if(mode==='tray')api.invoke('interaction',{dragging:false});target=null;if(id!=='main'){const row=slider.closest('.tray-row');row?.classList.remove('editing');if(!row?.matches(':hover')){trayDrafts.delete(id);renderTray();}}};
    slider.addEventListener('pointerup',end);slider.addEventListener('pointercancel',event=>{if(frame!=null)cancelAnimationFrame(frame);frame=null;pending=null;dragging=false;if(mode==='tray')api.invoke('interaction',{dragging:false});target=null;slider.closest('.tray-row')?.classList.remove('editing');});
    for(const input of slider.querySelectorAll('[data-range]'))input.addEventListener('input',()=>{if(id==='main')setDraft(input.dataset.range,Number(input.value),data().model);else{const next=resizeDraft(data().value,Number(input.value),data().model);trayDrafts.set(id,next);updateTrayDraft(id,next,data().model);}});
  }
}
function updateTrayDraft(id,value,model){
  const row=[...document.querySelectorAll('.tray-row')].find(row=>row.dataset.id===id),chat=state?.threads.find(chat=>chat.id===id);if(!row||!value||!model||!row.querySelector('.slider'))return;
  const maximum=draftLimits(model,value.window,value.reserve).maximum,percentage=value.window/maximum*100;
  row.querySelector('.fill').style.width=percentage+'%';row.querySelector('.fill').classList.toggle('max-flow',model.context_ceiling===920000&&value.window===920000);row.querySelector('.thumb').style.left=percentage+'%';
  const label=row.querySelector('.tray-value');label.textContent=trayTarget(chat,value);label.classList.toggle('error',trayFeedback.get(id)?.error===true);
  row.querySelector('[data-action="tray-apply"]').disabled=!serviceAvailable||chat.modelMetadata?.context_catalog_ready===false||!trayChanged(value)||traySaving.has(id)||value.modelKey!==modelSignature(chat);row.querySelector('[data-action="tray-cancel"]').disabled=traySaving.has(id);
  for(const input of row.querySelectorAll('input'))input.disabled=!serviceAvailable||chat.modelMetadata?.context_catalog_ready===false||traySaving.has(id);
  updateParticles(row.querySelector('.slider'),value,maximum);
}

function trayRow(chat){
  let value=trayDrafts.get(chat.id);if(!value){value=threadDraft(chat);if(value)trayDrafts.set(chat.id,value);}
  const editable=!!value&&chat.modelMetadata?.context_catalog_ready!==false;
  return trayChatView({chat,title:chatName(chat),status:statusText(chat),draft:value,editable,changed:serviceAvailable&&trayChanged(value),saving:traySaving.has(chat.id),target:value?trayTarget(chat,value):'',fraction:observed(chat),slider,ring,e,t});
}

function renderTray(force=false){if(!force&&(dragging||document.querySelector('.tray-row:hover,.tray-row:focus-within')))return;trayDrafts.clear();const {running,recent}=trayState(state?.threads);root.innerHTML=`<div class="tray-shell"><button class="tray-top" data-action="open-main">${e(t('打开主窗口','Open main window'))}<span style="float:right" class="muted tiny">${e(preferences.shortcut?.enabled?shortcutLabel(preferences.shortcut.accelerator):'↗')}</span></button>${quotaPanel(true)}<div class="tray-list"><div class="tray-section row between"><span>${e(t('正在运行','Running'))}</span><span>${running.length}</span></div>${running.map(trayRow).join('')||`<p class="tiny muted" style="padding:0 10px">${e(t('暂无运行中的聊天','No running chats'))}</p>`}${recent.length?`<div class="tray-section row between"><span>${e(t('近期聊天','Recent chats'))}</span><span>${recent.length}</span></div>${recent.map(trayRow).join('')}`:''}</div><div class="tray-footer"><span class="row"><span class="dot ${state?.bridgeCount?'on':''}"></span>Context Manager</span><button class="flat" data-action="quit">${e(t('退出','Quit'))}</button></div></div>`;bindSliders();for(const row of document.querySelectorAll('.tray-row')){row.addEventListener('mouseleave',()=>{if(dragging||traySaving.has(row.dataset.id))return;trayFeedback.delete(row.dataset.id);row.classList.remove('canceled');const chat=state.threads.find(t=>t.id===row.dataset.id),d=threadDraft(chat);if(d){trayDrafts.set(chat.id,d);updateTrayDraft(chat.id,d,chat.modelMetadata);}});row.addEventListener('click',event=>{if(!event.target.closest('button,.slider'))api.invoke('open-main',{id:row.dataset.id});});row.addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target===row)api.invoke('open-main',{id:row.dataset.id});});}}
function detailsDialog(){return detailsView({title:chatName(current()),stats,content:stats?statsBody():statsLoading?statsBody():'<div class="empty">'+e(t('暂无上下文统计','No context statistics'))+'</div>',loading:statsLoading,error:statsError,auto,e,t});}

function statsBody(){return statisticsView({stats,period,e,t,k,amount,money,modelName:modelDisplayName});}

function drawCharts(){
  const container=document.querySelector('#charts');if(!container||!stats)return;
  const pinPosition=timeline?.buckets[pinned]?.position;timeline=timelineData(stats.responses||[],stats.timelineEvents||[],{period});if(pinPosition!=null)pinned=nearestBucket(timeline,pinPosition);
  const {width:w,height:h,padding}=timelinePlot;
  const plot=(name,series)=>{
    const max=Math.max(1,...series.flatMap(s=>s.points.map(p=>p.value)));
    const paths=series.map(s=>{
      const groups=new Map();for(const point of s.points){if(!groups.has(point.series))groups.set(point.series,[]);groups.get(point.series).push(point);}
      return [...groups.values()].map(points=>`<path data-series="${s.key}" stroke="${s.color}" d="${points.map((point,i)=>(i?'L':'M')+timelineX(point.position,timeline.upperBound).toFixed(2)+','+(h-20-point.value/max*(h-30)).toFixed(2)).join(' ')}"/>`).join('');
    }).join('');
    const dots=series.map(s=>`<circle class="chart-selection-point" data-measure="${s.key}" r="3.5" stroke="${s.color}" visibility="hidden"/>`).join('');
    return `<div class="plot" data-plot="${name}" data-maximum="${max}"><span class="axis">${e(name==='speed'?t('生成速度 · tokens/s','Generation · tokens/s'):t('输入与缓存 · tokens','Input and cache · tokens'))} · ${e(k(max))}</span><svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-label="${e(name==='speed'?t('生成速度趋势','Generation speed trend'):t('输入和缓存趋势','Input and cache trend'))}" role="img">${[30,65,100].map(y=>`<line class="chart-grid" x1="${padding}" y1="${y}" x2="${w-padding}" y2="${y}"/>`).join('')}${paths}${dots}</svg><i class="chart-cursor"></i></div>`;
  };
  container.innerHTML=plot('speed',[{key:'speed',points:timeline.speed,color:'#6d9dff'}])+plot('cache',[{key:'input',points:timeline.input,color:'#aaa'},{key:'cache',points:timeline.cache,color:'#78b8cf'}])+`<div class="chart-label"><span>● ${e(t('输入','Input'))}</span><span style="color:#78b8cf">● ${e(t('缓存读取','Cached reads'))}</span></div><div class="plot events-plot" data-plot="events">${timeline.buckets.flatMap(bucket=>[['user_input',bucket.users,6],['final',bucket.finals,20],['compaction',bucket.compactions,10]].filter(([,count])=>count>0).map(([type,count,top])=>`<i class="event-marker ${type}" data-bucket="${bucket.id}" style="left:${timelineX(bucket.position,timeline.upperBound,100)}%;top:${top}px" title="${e(type)} · ${count}"></i>`)).join('')}<i class="chart-cursor"></i></div>`;
  let pending=null,frame=null;
  const select=(plot,event)=>{
    const rect=plot.getBoundingClientRect(),position=timelinePosition(event.clientX-rect.left,timeline.upperBound,rect.width);
    hover=position==null?null:nearestBucket(timeline,position);updateChartSelection();
  };
  for(const plot of container.querySelectorAll('[data-plot]')){
    plot.addEventListener('pointermove',event=>{pending={plot,event};if(frame==null)frame=requestAnimationFrame(()=>{frame=null;if(pending)select(pending.plot,pending.event);pending=null;});});
    plot.addEventListener('pointerleave',()=>{if(frame!=null)cancelAnimationFrame(frame);frame=null;pending=null;hover=null;updateChartSelection();queueMicrotask(applyDeferredStats);});
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
}

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
  if(!detailsOpen||!selected||document.hidden&&!force||statsLoading||smoothingInteracting&&!force)return;
  const id=selected,epoch=detailsEpoch;let repaint=force||!stats||!!statsError;statsLoading=true;lastStats=Date.now();if(force||!stats)render();
  try{const result=await api.invoke('statistics',{id,refresh:force});if(id!==selected||!detailsOpen||epoch!==detailsEpoch)return;statsError='';if((hover!=null||smoothingInteracting)&&!force){deferredStats=result;return;}repaint=acceptStats(result)||repaint;}
  catch(error){if(id===selected&&detailsOpen&&epoch===detailsEpoch){statsError=error.message;repaint=true;notify(error.message);}}
  finally{if(epoch===detailsEpoch){statsLoading=false;if(detailsOpen&&id===selected&&hover==null&&!smoothingInteracting&&repaint)render();}}
}

function selectChat(id){if(detailsOpen)closeDetails();mainNotice='';budgetInputError='';budgetText={};if(settingsOpen)closeSettings();selected=id;view='chat';draft=threadDraft(current());dirty=false;stats=null;statsJSON='';pinned=hover=null;render();}
function loadDraft(){if(editingDefaults()){const d=state?.newChatDefaults;draft=d?{window:d.usableWindow,compact:d.compact,reserve:16000,retainedFloor:0,expectedRevision:d.revision}:null;}else{const next=threadDraft(current());if(draft?.expectedRevision!==next?.expectedRevision){budgetText={};budgetInputError='';}draft=next;}dirty=false;}
async function refresh(){if(refreshing||dragging)return;refreshing=true;try{preferences=await api.invoke('preferences');if(settingsOpen&&!shortcutDirty&&!shortcutRecording){shortcutDraft=preferences.shortcut?.accelerator||DEFAULT_SHORTCUT;shortcutEnabled=preferences.shortcut?.enabled!==false;}document.documentElement.lang=preferences.language==='zh'?'zh-CN':'en';const next=await api.invoke('state');state=next;serviceAvailable=true;if(!selected||!current())selected=state.threads[0]?.id??null;if(!dirty)loadDraft();updateTrayAvailability();if(mode==='main'&&!settingsOpen&&!detailsOpen)refreshBudgetValidity();if(settingsOpen){if(!busy&&!shortcutRecording&&!document.activeElement?.closest('.settings-dialog'))render();return;}if(hover==null&&pinned==null&&!document.activeElement?.matches('input,select')){if(view==='stats'&&mode==='main'&&root.querySelector('#stats-body')){root.querySelector('.sidebar').outerHTML=sidebar();bindSidebar();}else if((!dirty&&!detailsOpen)||mode==='tray')render();else{document.querySelector('#phase')?.replaceChildren(document.createTextNode(phase(current())));const message=document.querySelector('#phase-message');if(message)message.textContent=t(current()?.message||'');}}if(detailsOpen&&auto&&Date.now()-lastStats>10000&&hover==null)await loadStats();}catch(error){serviceAvailable=false;if(state){state={...state,quota:state.quota?{...state.quota,stale:true}:state.quota,bridgeCount:0,threads:state.threads.map(t=>({...t,connected:false,freshUsage:false,phase:'disconnected'}))};updateTrayAvailability();render();}if(!state)root.innerHTML=`<div class="empty"><h2>Context Manager</h2><p>${e(error.message)}</p><button data-action="retry">${e(t('重试','Retry'))}</button></div>`;}finally{refreshing=false;}}
root.addEventListener('click',async event=>{const button=event.target.closest('[data-action]');if(!button)return;const action=button.dataset.action;if(button.disabled)return;
  try{
    if(action==='settings'){openSettings();return;}
    if(action==='settings-close'){closeSettings();return;}
    if(action==='settings-dismiss'){if(event.target===button)closeSettings();return;}
    if(action==='settings-tab'){switchSettingsTab(button.dataset.tab);return;}
    if(action==='details-close'){closeDetails();return;}
    if(action==='details-dismiss'){if(event.target===button)closeDetails();return;}
    if(action==='open-reference'){await api.invoke(action,{id:button.dataset.reference});return;}
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
      await api.invoke('shortcut-recording',{active:true});shortcutRecording=true;render();document.getElementById('shortcut-input')?.focus();return;
    }
    if(action==='shortcut-reset'){finishShortcutRecording();shortcutDraft=DEFAULT_SHORTCUT;shortcutEnabled=true;shortcutDirty=true;render();return;}
    if(action==='shortcut-save'){
      finishShortcutRecording();await api.invoke('shortcut-recording',{active:false});
      const saved=await run('shortcut-save',{accelerator:normalizeShortcut(shortcutDraft),enabled:shortcutEnabled});
      preferences.shortcut=saved;shortcutDraft=saved.accelerator;shortcutDirty=false;render();notify(saved.inactive?t('预览设置已保存；真实模式中需单独保存。','Preview preference saved. Save it separately in local mode.'):t('快捷键设置已保存','Shortcut settings saved'));return;
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
    if(action==='preflight'||action==='apply'){
      if(budgetInputError)throw Error(budgetInputError);
      const params={id:selected,policy:policyForDraft(draft,current().modelMetadata),...(action==='apply'?{expectedRevision:draft.expectedRevision,apply:true}:{})};
      try{
        if(action==='preflight'){const result=await run(action,params);setNotice([result.message||t('预检完成','Preflight completed'),...(result.notes||[])].join('\n'),result.allowed===false);}
        else{await run('policy',params);dirty=false;setNotice(t('预算已保存。请查看下方应用状态；实际值将在正常下一轮请求后确认。','Budget saved. Check the application status; actual values are confirmed after the next normal request.'));await refresh();}
      }catch(error){setNotice(error.message,true);throw error;}return;
    }
    if(action==='clear'){await run('clear',{id:selected});dirty=false;setNotice(t('操作已提交。','Operation submitted.'));await refresh();return;}
    if(action==='compact'){if((await api.invoke('confirm-compact')).confirmed){await run('compact',{id:selected});setNotice(t('操作已提交。','Operation submitted.'));await refresh();}return;}
    if(action==='scan'){await run('scan');await refresh();if(settingsOpen)render();return;}
    if(action==='update'){await run(state.update?.available?'install-update':'check-update');await refresh();if(settingsOpen)render();return;}
    if(action==='stats'){openDetails();return;}
    if(action==='back'){if(detailsOpen)closeDetails();else{view='chat';hover=pinned=null;loadDraft();render();}return;}
    if(action==='refresh-stats'){hover=null;await loadStats(true);return;}
    if(action==='raw-prev'||action==='raw-next'){page+=action==='raw-next'?1:-1;renderRaw();return;}
    if(action==='raw-select'){const index=timeline?.byID.get(button.dataset.id);if(index!=null){rawSelectedID=button.dataset.id;pinned=timeline.mapping[index];hover=null;updateChartSelection();}return;}
    if(action==='tray-apply'){
      const chat=state.threads.find(t=>t.id===button.dataset.id),d=trayDrafts.get(chat?.id);if(!d||!serviceAvailable||traySaving.has(chat.id)||!trayChanged(d))return;
      traySaving.add(chat.id);updateTrayDraft(chat.id,d,chat.modelMetadata);
      try{
        if(d.modelKey!==modelSignature(chat))throw Error(t('模型信息已变化，请取消后重新调整','Model metadata changed. Cancel and adjust again.'));
        const result=await api.invoke('policy',{id:chat.id,policy:policyForDraft(d,chat.modelMetadata),expectedRevision:d.expectedRevision,apply:true});
        if(result.thread){state.threads=state.threads.map(item=>item.id===chat.id?{...item,...result.thread}:item);}
        const code=result.plan?.code,updated=state.threads.find(item=>item.id===chat.id),messages={waiting_for_idle:t('已保存 · 本轮结束后应用','Saved · apply after this turn'),needs_compaction:t('已保存 · 需先压缩再应用','Saved · compaction required'),needs_observation:t('已保存 · 等待用量读回','Saved · waiting for usage')};
        trayFeedback.set(chat.id,{message:!updated.connected?t('已保存 · 接入后自动应用','Saved · apply when connected'):messages[code]||t('已提交 · 等待读回确认','Submitted · awaiting confirmation'),error:code==='needs_compaction'});
        const next=threadDraft(updated);if(next)trayDrafts.set(chat.id,next);
      }catch(error){trayFeedback.set(chat.id,{message:error.message,error:true});}
      finally{traySaving.delete(chat.id);const updated=state.threads.find(item=>item.id===chat.id);updateTrayDraft(chat.id,trayDrafts.get(chat.id),updated.modelMetadata);}
      return;
    }
    if(action==='tray-cancel'){const chat=state.threads.find(t=>t.id===button.dataset.id),d=threadDraft(chat);trayFeedback.delete(chat.id);trayDrafts.set(chat.id,d);updateTrayDraft(chat.id,d,chat.modelMetadata);button.closest('.tray-row').classList.add('canceled');return;}
    if(action==='diagnostics'){const data=await api.invoke('diagnostics');notify(JSON.stringify(data));return;}
    if(action==='retry'){await refresh();return;}
    if(['open-main','open-codex','quit','open-live','open-logs'].includes(action))await api.invoke(action);
  }catch(error){if(['preflight','apply','clear','compact'].includes(action)&&!settingsOpen)setNotice(error.message,true);notify(error.message);}
});
root.addEventListener('pointerdown',event=>{if(event.target.id==='smoothing')smoothingInteracting=true;});
window.addEventListener('pointerup',()=>{if(smoothingInteracting){smoothingInteracting=false;queueMicrotask(applyDeferredStats);}});
window.addEventListener('pointercancel',()=>{smoothingInteracting=false;});
root.addEventListener('change',async event=>{const target=event.target;try{
  if(target.id==='language'){await api.invoke('language',{selection:target.value});preferences=await api.invoke('preferences');render();}
  if(target.id==='quota-pool'){await api.invoke('quota-select',{id:target.value});preferences.quotaPool=target.value;render();}
  if(target.id==='shortcut-enabled'){shortcutEnabled=target.checked;shortcutDirty=true;}
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
  if(!settingsOpen&&!detailsOpen)return;
  if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();if(detailsOpen)closeDetails();else closeSettings();return;}
  if(event.key!=='Tab')return;
  const modal=root.querySelector(detailsOpen?'.details-dialog':'.settings-dialog'),fields=[...modal.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]')];
  const first=fields[0],last=fields.at(-1);
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
},true);
document.addEventListener('keydown',event=>{if(event.key==='Escape'){if(mode==='tray')api.invoke('hide');else if(pinned!=null){pinned=null;hover=null;updateChartSelection();}else if(view!=='chat'){view='chat';loadDraft();render();}}});
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
window.__contextSmoke=async()=>{
  const initial=!!state&&!!root.querySelector(mode==='tray'?'.tray-shell':'.shell')&&!!root.querySelector('[data-slider]');let defaults=true,charts=true,settings=true,geometry={ok:true},radius=true;
  if(mode==='main'&&preferences.demo){
    radius=['[data-action="apply"]','[data-action="preflight"]','[data-action="clear"]','[data-action="stats"]','.pill','#language','.sidebar-footer>button'].every(selector=>[...root.querySelectorAll(selector)].every(node=>getComputedStyle(node).borderTopLeftRadius==='10px'));
    radius=radius&&root.querySelector('[data-action="stats"]').getBoundingClientRect().height<48;
    openSettings('defaults');defaults=root.querySelector('.settings-dialog').querySelectorAll('[data-range]').length===2;closeSettings();
    selectChat(state.threads[0].id);root.querySelector('[data-action="stats"]').click();
    const deadline=Date.now()+5000;while(!document.querySelector('[data-plot]')&&Date.now()<deadline)await new Promise(r=>setTimeout(r,30));
    charts=document.querySelectorAll('[data-plot]').length===3&&!!timeline?.entries.length;if(charts)geometry=chartGeometryCheck();
    openSettings('shortcut');settings=!!document.querySelector('#shortcut-input')&&document.querySelector('#shortcut-input').value==='Ctrl + Shift + M'&&!!document.querySelector('[data-action="shortcut-save"]');
    const saved=await api.invoke('shortcut-save',{accelerator:'Control+Alt+K',enabled:true});preferences=await api.invoke('preferences');settings=settings&&saved.accelerator==='Control+Alt+K'&&preferences.shortcut.accelerator==='Control+Alt+K'&&preferences.shortcut.inactive;
    await api.invoke('shortcut-save',{accelerator:DEFAULT_SHORTCUT,enabled:true});preferences=await api.invoke('preferences');selectChat(state.threads[0].id);
  }
  return {ok:initial&&defaults&&charts&&settings&&geometry.ok&&radius,mode,chats:state?.threads.length,defaults,charts,settings,geometry,radius,isolated:typeof window.require==='undefined'};
};
await refresh();
setInterval(()=>{if(!document.hidden&&!dragging&&hover==null)refresh();},2000);
