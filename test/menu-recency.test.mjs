import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
test('recent menu retains completed disconnected chats and excludes inactive unknown or managed sessions',{skip:process.platform!=='darwin'},()=>{
 const repo=fileURLToPath(new URL('../',import.meta.url)),temp=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-menu-recency-'));
 try{const source=fs.readFileSync(path.join(repo,'macos/ContextControl.swift'),'utf8'),menu=fs.readFileSync(path.join(repo,'macos/ContextMenu.swift'),'utf8');
 fs.writeFileSync(path.join(temp,'Models.swift'),source.slice(0,source.indexOf('@MainActor final class Controller'))+fs.readFileSync(path.join(repo,'macos/TaskQueues.swift'),'utf8').split('extension Controller')[0]+'\n@MainActor final class Controller {var chats:[Chat]=[];var serviceAvailable=true;var menuHeightLimit:CGFloat=600}\n');
 fs.writeFileSync(path.join(temp,'Menu.swift'),menu.slice(0,menu.indexOf('@MainActor func managerStatusImage')));
 fs.writeFileSync(path.join(temp,'Main.swift'),String.raw`
import Foundation
@main @MainActor struct Main {
 static func main() throws {
  func chat(_ id:String,_ status:String,_ connected:Bool,_ time:Int,_ extra:[String:Any]=[:]) throws -> Chat {
   var raw:[String:Any]=["id":id,"name":id,"status":status,"connected":connected,"ambiguous":false,"lastActivityAt":time]
   raw.merge(extra,uniquingKeysWith:{$1});return try JSONDecoder().decode(Chat.self,from:JSONSerialization.data(withJSONObject:raw))
  }
  let compensated=try chat("compensated","active",true,100,["observedWindow":1420000,"lastUsage":["totalTokens":800000],"compensation":["enabled":true,"status":"active","extraTokens":500000,"targetWindow":920000,"runtimeWindow":1420000]])
  precondition(compensated.displayedContextWindow==920000 && compensated.contextFraction==Double(800000)/920000)
  let model=Controller()
  model.chats=[try chat("running","active",true,100),try chat("finished","notLoaded",false,99),try chat("older","idle",true,90),try chat("unknown","idle",true,0),try chat("temporary","idle",true,110,["ephemeral":true]),try chat("agent","active",true,110,["threadSource":"agent"])]
  precondition(model.runningChats.map(\.id)==["running"])
  precondition(model.recentChats.map(\.id)==["finished","older"])
  model.serviceAvailable=false
  precondition(model.runningChats.isEmpty)
  precondition(model.recentChats.map(\.id)==["running","finished","older"])
  print("Completed chats remain visible after unload/disconnect; temporary and agent sessions stay hidden.")
 }
}
`);
 const binary=path.join(temp,'check');let r=spawnSync('xcrun',['swiftc','-parse-as-library',path.join(repo,'macos/Localization.swift'),path.join(repo,'macos/ProductVersion.swift'),path.join(temp,'Models.swift'),path.join(temp,'Menu.swift'),path.join(temp,'Main.swift'),'-o',binary,'-framework','SwiftUI','-framework','AppKit'],{encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stderr);r=spawnSync(binary,[],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
