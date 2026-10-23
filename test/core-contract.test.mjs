import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {normalizeBudgetCommand,budgetCommand} from '../src/core/budget-command.mjs';
import {policyForThreadDraft} from '../src/core/budget-editor.mjs';
import {normalizeStateDocument} from '../src/core/state-document.mjs';
import {manifestCandidate} from '../src/core/update-artifact.mjs';
const fixtures=JSON.parse(fs.readFileSync(new URL('./fixtures/contracts/budgets.json',import.meta.url)));
test('connection conflicts take priority over the generic model readiness hint',()=>{
 const model={max_context_window:1000000,effective_context_window_percent:90,context_catalog_ready:false},draft={window:400000,compact:360000,reserve:16000,retainedFloor:0};
 assert.throws(()=>policyForThreadDraft(draft,model,{ambiguous:true}),/检测到多个接入进程，请完整重启 Codex/);
 assert.throws(()=>policyForThreadDraft(draft,model,{ambiguous:false}),/请先在 Codex 打开此聊天/);
 assert.doesNotThrow(()=>policyForThreadDraft(draft,{...model,context_catalog_ready:true},{ambiguous:false}));
});
test('both client payloads resolve through the same authoritative visible-budget contract',()=>{
 for(const c of fixtures){const model={effective_context_window_percent:c.percent,max_context_window:c.maximum},draft={window:c.usableWindow,compact:c.compact,reserve:16000,retainedFloor:0};const legacy=policyForThreadDraft(draft,model),visible=budgetCommand(draft,legacy,{visibleBudget:true});
 assert.equal(legacy.window,c.rawWindow);assert.deepEqual(normalizeBudgetCommand(visible,model),legacy);assert.deepEqual(normalizeBudgetCommand({policy:legacy},model),legacy);assert.ok(!Object.hasOwn(visible.budget,'window'));}
 assert.throws(()=>normalizeBudgetCommand({budget:{usableWindow:400000},policy:{}},{}));
});
test('state migration preserves future fields and rejects destructive resets',()=>{
 const doc={version:9,policies:{a:{window:500000}},threads:{a:{name:'Valid'}},future:{keep:true}};assert.deepEqual(normalizeStateDocument(doc),doc);assert.notEqual(normalizeStateDocument(doc),doc);assert.throws(()=>normalizeStateDocument({threads:[],policies:{}}));assert.equal(normalizeStateDocument({version:1,threads:{a:{name:'private legacy prompt'}},policies:{}}).threads.a.name,null);
});
test('multi-platform update manifests select only the requested system and architecture',()=>{
 const entry=(filename)=>({filename,size:100,sha256:'a'.repeat(64)}),doc={schemaVersion:2,version:'0.19.6',tag:'v0.19.6-preview.1',assets:{'darwin-arm64':entry('Context-Manager-0.19.6-macos-arm64.dmg'),'win32-x64':entry('Context-Manager-0.19.6-windows-x64.zip')}};
 assert.match(manifestCandidate(doc,{platform:'win32',arch:'x64'}).filename,/windows-x64\.zip$/);assert.match(manifestCandidate(doc,{platform:'darwin',arch:'arm64'}).filename,/macos-arm64\.dmg$/);assert.equal(manifestCandidate(doc,{platform:'win32',arch:'arm64'}),null);
});
test('native Swift previews satisfy the same budget fixtures as the shared core',{skip:process.platform!=='darwin'},()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-parity-')),repo=fileURLToPath(new URL('../',import.meta.url));try{
 const source=path.join(dir,'Main.swift');fs.writeFileSync(source,`import Foundation\n@main struct Check {static func main() throws {let cases=try JSONSerialization.jsonObject(with:Data(contentsOf:URL(fileURLWithPath:CommandLine.arguments[1]))) as! [[String:Any]];for c in cases {let b=try BudgetMath.sliderPreview(windowK:(c["usableWindow"] as! Int)/1000,compactK:(c["compact"] as! Int)/1000,effectivePercent:c["percent"] as! Int,maximumRawWindow:c["maximum"] as! Int);precondition(b.rawWindow==c["rawWindow"] as! Int);precondition(b.compact==c["compact"] as! Int)} }}\n`);
 const binary=path.join(dir,'check');let r=spawnSync('xcrun',['swiftc','-parse-as-library',path.join(repo,'macos/Localization.swift'),path.join(repo,'macos/BudgetMath.swift'),source,'-o',binary],{encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stderr);r=spawnSync(binary,[path.join(repo,'test/fixtures/contracts/budgets.json')],{encoding:'utf8',timeout:10000});assert.equal(r.status,0,r.stderr);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
