import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createContextExtensionManager} from '../src/context-extension.mjs';import {prepareContextCatalog,policyForModel,ceilingModel} from '../src/context-ceiling.mjs';import {policyForNewChat,clampNewChatDefaults,newChatDefaultLimits} from '../src/new-chat-defaults.mjs';
const native={slug:'fixture',context_window:272000,max_context_window:872000,effective_context_window_percent:95};
test('extension distinguishes off, waiting for Codex, pending restart and actually active',()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-extension-'));try{const m=createContextExtensionManager({home});assert.equal(m.status().enabled,false);assert.equal(m.status().effective,false);assert.equal(m.status().pending,false);
 m.setEnabled(true);assert.equal(m.status().effective,false);assert.match(m.status().message,/等待 Codex 启动/);assert.equal(m.status().pending,false);
 assert.equal(m.status([{}]).pending,true);assert.equal(m.status([{}]).effective,false);
 const active=[{contextCeiling:1,contextCatalogRevision:2}];assert.equal(m.status(active).effective,true);assert.equal(m.status(active).pending,false);
 m.setEnabled(false);assert.equal(m.status(active).effective,false);assert.equal(m.status(active).pending,true);assert.match(m.status(active).message,/恢复原生/);assert.equal(m.status([{}]).pending,false);
 assert.equal(createContextExtensionManager({home}).enabled(),false);assert.throws(()=>m.setEnabled('false'));
 fs.writeFileSync(path.join(home,'context-extension.json'),'{broken');assert.equal(m.enabled(),false);
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
test('switching modes preserves valid budgets and clamps oversized ones to native capacity',()=>{
 const extended=policyForNewChat({usableWindow:920000,compact:904000,revision:3});const off=policyForModel(extended,native);
 assert.equal(off.window,872000);assert.equal(Math.floor(off.window*.95),828400);assert.equal(off.compact,784800);assert.equal(off.contextCeilingVersion,undefined);assert.equal(off.effectivePercent,95);
 const on=policyForModel(off,ceilingModel(native));assert.equal(Math.floor(on.window*.9),828400);assert.equal(on.compact,784800);
 const smaller=policyForNewChat({usableWindow:500000,compact:450000,revision:3});assert.equal(Math.floor(policyForModel(smaller,native).window*.95),500000);
 const defaults=clampNewChatDefaults({usableWindow:920000,compact:904000,revision:2},native);assert.equal(defaults.usableWindow,828000);assert.equal(defaults.compact,784000);
 const p=policyForNewChat(defaults,native);assert.equal(p.effectivePercent,95);assert.equal(p.contextCeilingVersion,undefined);assert.equal(Math.floor(p.window*.95),828000);assert.equal(newChatDefaultLimits(native).maximumUsableWindow,828000);
 const different={...native,max_context_window:400000,effective_context_window_percent:100};const otherPolicy=policyForNewChat({usableWindow:920000,compact:904000,revision:0},different);assert.equal(otherPolicy.window,400000);assert.equal(otherPolicy.compact,360000);assert.equal(otherPolicy.effectivePercent,100);assert.equal(newChatDefaultLimits(different).maximumUsableWindow,400000);
});
test('a fresh installation does not inject an expanded catalog until explicitly enabled',()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-extension-catalog-'));try{fs.writeFileSync(path.join(home,'models_cache.json'),JSON.stringify({models:[native]}));assert.equal(prepareContextCatalog({home,control:home}),null);createContextExtensionManager({home}).setEnabled(true);assert.equal(prepareContextCatalog({home,control:home}).version,1);}finally{fs.rmSync(home,{recursive:true,force:true});}
});
