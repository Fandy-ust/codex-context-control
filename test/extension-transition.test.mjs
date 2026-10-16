import test from 'node:test';import assert from 'node:assert/strict';
import {transitionExtensionBudgets} from '../src/extension-transition.mjs';import {ceilingModel,policyForModel} from '../src/context-ceiling.mjs';import {policyForNewChat} from '../src/new-chat-defaults.mjs';
const native={context_window:272000,max_context_window:872000,effective_context_window_percent:95},extended=ceilingModel(native);
const defaults={usableWindow:920000,compact:904000,revision:0};
test('off/on restores original unclamped budgets and defaults while revisions only increase',()=>{
 const policy=policyForNewChat(defaults);let data={policies:{a:policy},defaults};
 for(let i=0;i<100;i++){
  const previous=data.policies.a.revision;data=transitionExtensionBudgets(data,false,()=>native,native);assert.equal(Math.floor(data.policies.a.window*.95),828400);assert.ok(data.policies.a.revision>previous);
  data=transitionExtensionBudgets(data,true,()=>extended,extended);assert.equal(data.policies.a.window,policy.window);assert.equal(data.policies.a.compact,904000);assert.equal(data.defaults.usableWindow,920000);assert.equal(data.defaults.compact,904000);
 }
});
test('explicit edits while off win; stopping automation cannot silently reactivate it',()=>{
 let data=transitionExtensionBudgets({policies:{a:policyForNewChat(defaults),b:policyForNewChat(defaults)},defaults},false,()=>native,native);
 data.policies.a=policyForNewChat({usableWindow:500000,compact:450000,revision:1},native);delete data.restore.policies.a;
 data.policies.b.enabled=false;data.defaults={usableWindow:400000,compact:360000,revision:2};delete data.restore.defaults;
 data=transitionExtensionBudgets(data,true,()=>extended,extended);
 assert.equal(Math.floor(data.policies.a.window*.9),500000);assert.equal(data.policies.b.enabled,false);assert.equal(data.defaults.usableWindow,400000);
});
test('legacy native budgets without a saved percentage keep their visible capacity on first enable',()=>{
 const p={window:736843,compact:630000,reserve:16000,retainedFloor:0,revision:3,enabled:true};const next=policyForModel(p,extended);
 assert.equal(Math.floor(next.window*.9),700000);assert.equal(next.compact,630000);
});
