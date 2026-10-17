import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
test('the trailing quota bolt gradually loses fill while keeping the context icon unchanged',{skip:process.platform!=='darwin',timeout:90000},()=>{
 const repo=fileURLToPath(new URL('../',import.meta.url)),dir=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-bolt-'));
 try{
 fs.writeFileSync(path.join(dir,'Control.swift'),fs.readFileSync(path.join(repo,'macos/ContextControl.swift'),'utf8').replace('@main @MainActor final class ContextControlApp','@MainActor final class ContextControlApp'));
 fs.writeFileSync(path.join(dir,'Main.swift'),String.raw`
import AppKit
@main @MainActor struct Check {
 static func main() throws {
  _ = NSApplication.shared
  func image(_ remaining:Double) throws -> NSBitmapImageRep {
   let data:[String:Any]=["id":"codex","name":"Codex","primary":["usedPercent":100-remaining,"remainingPercent":remaining,"windowDurationMins":300]]
   let bucket=try JSONDecoder().decode(QuotaBucket.self,from:JSONSerialization.data(withJSONObject:data))
   let icon=combinedStatusImage(progress:0.4,bucket:bucket,stale:false);precondition(icon.size==NSSize(width:36,height:22));return NSBitmapImageRep(data:icon.tiffRepresentation!)!
  }
  func coverage(_ bitmap:NSBitmapImageRep,_ left:Bool)->Double {
   let split=Int(Double(bitmap.pixelsWide)*24/36);var sum=0.0
   for y in 0..<bitmap.pixelsHigh {for x in (left ? 0:split)..<(left ? split:bitmap.pixelsWide){sum+=Double(bitmap.colorAt(x:x,y:y)!.alphaComponent)}};return sum
  }
  let full=try image(100),half=try image(50),empty=try image(0)
  precondition(coverage(full,false)>coverage(half,false) && coverage(half,false)>coverage(empty,false))
  precondition(abs(coverage(full,true)-coverage(empty,true))<0.01)
  print("bolt full > half > hollow; context pixels unchanged")
 }
}
`);
 const sources=fs.readdirSync(path.join(repo,'macos')).filter(n=>n.endsWith('.swift')&&n!=='ContextControl.swift').map(n=>path.join(repo,'macos',n));
 const binary=path.join(dir,'check');let r=spawnSync('xcrun',['swiftc','-parse-as-library',...sources,path.join(dir,'Control.swift'),path.join(dir,'Main.swift'),'-o',binary],{encoding:'utf8',timeout:60000});assert.equal(r.status,0,r.stderr);r=spawnSync(binary,[],{encoding:'utf8',timeout:10000});assert.equal(r.status,0,r.stdout+r.stderr);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
