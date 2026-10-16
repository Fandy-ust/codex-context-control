import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('menu budgets preserve linking, revision and reserves; right-aligned panels remain on screen',{skip:process.platform!=='darwin',timeout:60000},()=>{
 const root=fileURLToPath(new URL('../',import.meta.url)),temp=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-menu-controls-'));
 try{
  const source=fs.readFileSync(path.join(root,'macos/ContextControl.swift'),'utf8');
  fs.writeFileSync(path.join(temp,'Models.swift'),source.slice(0,source.indexOf('@MainActor final class Controller')));
  fs.writeFileSync(path.join(temp,'main.swift'),String.raw`
import Foundation
import AppKit
let data=Data(#"{"id":"child","model":"fixture","connected":true,"ambiguous":false,"policy":{"window":757895,"compact":646000,"reserve":20000,"retainedFloor":100000,"revision":3,"enabled":true},"modelMetadata":{"max_context_window":872000,"effective_context_window_percent":95}}"#.utf8)
let chat=try JSONDecoder().decode(Chat.self,from:data)
var draft=try MenuBudgetDraft(chat:chat)
precondition(draft.windowK==720 && draft.compactK==646 && !draft.changed)
precondition(draft.chatID=="child" && draft.revision==3)
for _ in 0..<30 {draft.setWindow(600);precondition(draft.compactK==538);draft.setWindow(720);precondition(draft.compactK==646)}
draft.setCompact(500);draft.setWindow(600);precondition(draft.compactK==416);draft.setWindow(720);precondition(draft.compactK==500)
let policy=try draft.policy()
precondition(policy["window"] as? Int==757895 && policy["compact"] as? Int==500000)
precondition(policy["reserve"] as? Int==20000 && policy["retainedFloor"] as? Int==100000)
draft.setWindow(9999);precondition(draft.windowK==828 && draft.compactK<=Double(draft.maximumCompactK))
draft.setWindow(0);draft.setCompact(0);precondition(draft.windowK==2 && draft.compactK==1)
let size=NSSize(width:400,height:560)
let normal=NSRect(x:0,y:0,width:1920,height:1000)
let right=ContextMenuPlacement.frame(anchor:NSRect(x:1000,y:1000,width:30,height:30),size:size,screen:normal)
precondition(right.minX==992 && right.maxY<=992)
let edge=ContextMenuPlacement.frame(anchor:NSRect(x:1880,y:1000,width:30,height:30),size:size,screen:normal)
precondition(edge.maxX<=1912 && edge.minX>=8)
let secondary=NSRect(x:-1920,y:100,width:1920,height:800)
let other=ContextMenuPlacement.frame(anchor:NSRect(x:-100,y:900,width:30,height:30),size:size,screen:secondary)
precondition(secondary.insetBy(dx:8,dy:8).contains(other))
let small=NSRect(x:0,y:0,width:600,height:350)
let fit=ContextMenuPlacement.frame(anchor:NSRect(x:400,y:350,width:30,height:30),size:size,screen:small)
precondition(small.insetBy(dx:8,dy:8).contains(fit))
print("Native menu controls passed")
`);
  const binary=path.join(temp,'probe');
  const compiled=spawnSync('xcrun',['swiftc',path.join(root,'macos/BudgetMath.swift'),path.join(temp,'Models.swift'),path.join(root,'macos/MenuBudget.swift'),path.join(root,'macos/ContextMenuPanel.swift'),path.join(temp,'main.swift'),'-o',binary],{encoding:'utf8',timeout:45000});assert.equal(compiled.status,0,compiled.stderr);
  const run=spawnSync(binary,[],{encoding:'utf8',timeout:10000});assert.equal(run.status,0,run.stderr);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
