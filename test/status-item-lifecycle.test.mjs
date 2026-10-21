import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
test('native entry paints before data, repairs a missing image, rebuilds once and stays stopped',{skip:process.platform!=='darwin',timeout:45000},()=>{
 const repo=fileURLToPath(new URL('../',import.meta.url)),dir=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-status-life-'));
 try{
 const source=path.join(dir,'Main.swift'),binary=path.join(dir,'probe');fs.writeFileSync(source,String.raw`
import AppKit
struct QuotaBucket:Equatable{}
@MainActor func quotaBarsStatusImage(bucket:QuotaBucket?,stale:Bool)->NSImage{NSImage(systemSymbolName:"bolt.fill",accessibilityDescription:nil)!}
@main @MainActor struct Check{
 static func main(){
  _ = NSApplication.shared
  var renders=0,fail=false
  let owner=StatusItemController(renderer:{_,_ in renders+=1;return fail ? nil:quotaBarsStatusImage(bucket:nil,stale:false)},onClick:{})
  owner.update(bucket:nil,stale:true,tooltip:"offline");precondition(owner.item==nil)
  owner.start();let first=owner.item!;precondition(owner.diagnostics["menuImageReady"] as? Bool==true)
  owner.update(bucket:nil,stale:true,tooltip:"offline");precondition(renders==1)
  owner.button?.image=nil;owner.update(bucket:nil,stale:true,tooltip:"offline");precondition(renders==2 && owner.button?.image?.isValid==true)
  owner.button?.isHidden=true;owner.update(bucket:nil,stale:true,tooltip:"offline");precondition(owner.button?.isHidden==false)
  owner.start();precondition(owner.item===first)
  fail=true;owner.repair(rebuild:true);precondition(owner.item !== first && owner.diagnostics["menuImageReady"] as? Bool==true && owner.imageSource=="fallback")
  let screen=NSRect(x:0,y:0,width:1920,height:1080)
  precondition(!StatusItemController.isInMenuBar(NSRect(x:0,y:-7,width:60,height:22),screens:[screen],thickness:22))
  precondition(StatusItemController.isInMenuBar(NSRect(x:1860,y:1058,width:60,height:22),screens:[screen],thickness:22))
  precondition(!StatusItemController.isInMenuBar(NSRect(x:1900,y:1058,width:60,height:22),screens:[screen],thickness:22))
  owner.stop();owner.update(bucket:nil,stale:false,tooltip:"late response");owner.repair(rebuild:true);precondition(owner.item==nil)
  print("visible image, fallback, lifecycle and menu placement checks passed")
 }
}
`);
 let r=spawnSync('xcrun',['swiftc','-parse-as-library',path.join(repo,'macos/StatusItemController.swift'),path.join(repo,'macos/ContextMenuPanel.swift'),source,'-o',binary,'-framework','AppKit'],{encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stderr);r=spawnSync(binary,[],{encoding:'utf8',timeout:10000});assert.equal(r.status,0,r.stdout+r.stderr);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
