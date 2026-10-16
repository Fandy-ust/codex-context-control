import {tokenNumber,normalizePolicy} from './policy.mjs';
import {CONTEXT_CEILING_VERSION,MIN_CONTEXT_RESERVE,ceilingModel} from './context-ceiling.mjs';
const defaultModel=ceilingModel({context_window:272000,max_context_window:872000,effective_context_window_percent:95});
export const initialNewChatDefaults=Object.freeze({usableWindow:920000,compact:904000,revision:0});
export const nativeNewChatDefaults=Object.freeze({usableWindow:400000,compact:360000,revision:0});
export function newChatDefaultLimits(model=defaultModel){
 if(!model||!Number.isSafeInteger(model.max_context_window)||!Number.isInteger(model.effective_context_window_percent))return null;
 const percent=model.effective_context_window_percent,maximumUsableWindow=Math.floor(model.max_context_window*percent/100/1000)*1000;
 return {maximumUsableWindow,effectivePercent:percent,extended:!!model.context_ceiling};
}
export function compactLimit(usableWindow,model=defaultModel){return Math.floor(Math.min(Math.floor(Math.ceil(usableWindow*100/model.effective_context_window_percent)*.9),usableWindow-MIN_CONTEXT_RESERVE)/1000)*1000;}
export function normalizeNewChatDefaults(input,model=defaultModel){
 const usableWindow=tokenNumber(input.usableWindow,'默认窗口'),compact=tokenNumber(input.compact,'默认压缩阈值'),limit=newChatDefaultLimits(model)?.maximumUsableWindow;
 if(!limit)throw Error('等待 Codex 原生模型上限信息');
 if(usableWindow<34000||usableWindow>limit||usableWindow%1000)throw Error(`默认窗口请设置为 34K–${limit/1000}K，精度为 1K`);
 if(compact<=MIN_CONTEXT_RESERVE||compact>compactLimit(usableWindow,model)||compact%1000)throw Error('默认压缩阈值需遵守原生压缩上限，并为下一轮保留至少 16K');
 return {usableWindow,compact};
}
export function clampNewChatDefaults(defaults,model=defaultModel){
 const maximum=newChatDefaultLimits(model)?.maximumUsableWindow;if(!maximum)return {...defaults};
 const usableWindow=Math.min(defaults.usableWindow,maximum),compact=Math.min(defaults.compact,compactLimit(usableWindow,model));
 return {...defaults,usableWindow,compact};
}
export function policyForNewChat(defaults,model=defaultModel){
 const {usableWindow,compact}=normalizeNewChatDefaults(clampNewChatDefaults(defaults,model),model),percent=model.effective_context_window_percent;
 return {window:Math.ceil(usableWindow*100/percent),compact,reserve:MIN_CONTEXT_RESERVE,retainedFloor:0,scope:'total',enabled:true,revision:1,effectivePercent:percent,...(model.context_ceiling?{contextCeilingVersion:CONTEXT_CEILING_VERSION}:{}),sourceDefaultsRevision:defaults.revision??0};
}
export function isNewUserChat(params={}){params??={};return !params.ephemeral&&!params.forkedFromId&&!params.path&&params.canAcceptDirectInput!==false&&(params.threadSource==null||params.threadSource==='user');}
export function persistedNewChatPolicy(snapshot,model=defaultModel){
 if(!Number.isSafeInteger(snapshot?.sourceDefaultsRevision)||snapshot.sourceDefaultsRevision<0)throw Error('Invalid default-budget revision');
 const normalized=normalizePolicy(snapshot),visible=Math.floor(normalized.window*model.effective_context_window_percent/100);
 const expected=policyForNewChat({usableWindow:visible,compact:normalized.compact,revision:snapshot.sourceDefaultsRevision},model);
 if(normalized.window!==expected.window||normalized.compact!==expected.compact||normalized.reserve!==expected.reserve||normalized.retainedFloor!==0)throw Error('Invalid default-budget snapshot');
 return expected;
}
