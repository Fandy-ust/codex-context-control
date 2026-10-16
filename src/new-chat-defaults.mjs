import {tokenNumber,normalizePolicy} from './policy.mjs';
import {CEILING_PERCENT,CONTEXT_CEILING_VERSION,MAX_CONTEXT_INPUT,MIN_CONTEXT_RESERVE} from './context-ceiling.mjs';
export const initialNewChatDefaults=Object.freeze({usableWindow:920000,compact:904000,revision:0});
export function normalizeNewChatDefaults(input){
 const usableWindow=tokenNumber(input.usableWindow,'默认窗口'),compact=tokenNumber(input.compact,'默认压缩阈值');
 if(usableWindow<34000||usableWindow>MAX_CONTEXT_INPUT||usableWindow%1000)throw Error('默认窗口请设置为 34K–920K，精度为 1K');
 if(compact<=MIN_CONTEXT_RESERVE||compact>usableWindow-MIN_CONTEXT_RESERVE||compact%1000)throw Error('默认压缩阈值至少 17K，并为下一轮保留至少 16K');
 return {usableWindow,compact};
}
export function policyForNewChat(defaults){
 const {usableWindow,compact}=normalizeNewChatDefaults(defaults);
 return {window:Math.ceil(usableWindow*100/CEILING_PERCENT),compact,reserve:MIN_CONTEXT_RESERVE,retainedFloor:0,scope:'total',enabled:true,revision:1,effectivePercent:CEILING_PERCENT,contextCeilingVersion:CONTEXT_CEILING_VERSION,sourceDefaultsRevision:defaults.revision??0};
}
export function isNewUserChat(params={}){
 params??={};
 return !params.ephemeral&&!params.forkedFromId&&!params.path&&params.canAcceptDirectInput!==false&&(params.threadSource==null||params.threadSource==='user');
}
export function persistedNewChatPolicy(snapshot){
 if(!Number.isSafeInteger(snapshot?.sourceDefaultsRevision)||snapshot.sourceDefaultsRevision<0)throw Error('Invalid default-budget revision');
 const normalized=normalizePolicy(snapshot),visible=Math.floor(normalized.window*CEILING_PERCENT/100);
 const expected=policyForNewChat({usableWindow:visible,compact:normalized.compact,revision:snapshot.sourceDefaultsRevision});
 if(normalized.window!==expected.window||normalized.reserve!==expected.reserve||normalized.retainedFloor!==0)throw Error('Invalid default-budget snapshot');
 return expected;
}
