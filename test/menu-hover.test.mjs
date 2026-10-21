import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('native menu switches all five hover editors, resets drafts and locks only during drag',{skip:process.platform!=='darwin',timeout:180000},()=>{
 const rounds=Math.min(30,Math.max(1,Number(process.env.CONTEXT_CONTROL_STRESS_UI_ROUNDS)||6));
 const root=fileURLToPath(new URL('../',import.meta.url));
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-menu-hover-'));
 try {
  fs.writeFileSync(path.join(temp,'Control.swift'),fs.readFileSync(path.join(root,'macos/ContextControl.swift'),'utf8').replace('@main @MainActor final class ContextControlApp','@MainActor final class ContextControlApp'));
  // Keep production layout, geometry preferences and switching code. Feed the
  // list's pointer handler directly so this test never moves the user's cursor.
  let menu=fs.readFileSync(path.join(root,'macos/ContextMenu.swift'),'utf8')
   .replace('hoverSelection.updateFrames(frames);syncSelection()','hoverSelection.updateFrames(frames);syncSelection();HoverProbe.frames=frames')
   .replace('}.padding(8).frame(width:400,height:model.contextMenuHeight)','}.padding(8).frame(width:400,height:model.contextMenuHeight).onAppear{HoverProbe.move={pointerMoved(to:$0)}}')
   .replace('    var body:some View {\n        ZStack {\n            if let draft {',`    var body:some View {
        let _ = HoverProbe.record(chat.id,value:{draft?.windowK},edit:{draft?.setWindow($0)},drag:{active in dragging=active;dragChanged(active)})
        ZStack {
            if let draft {`);
  fs.writeFileSync(path.join(temp,'Menu.swift'),menu);
  fs.writeFileSync(path.join(temp,'Main.swift'),String.raw`
import SwiftUI
import AppKit
@MainActor enum HoverProbe {
 static var frames:[String:CGRect]=[:]
 static var move:((CGPoint?)->Void)?
 static var values:[String:()->Double?]=[:]
 static var edits:[String:(Double)->Void]=[:]
 static var drags:[String:(Bool)->Void]=[:]
 static func record(_ id:String,value:@escaping()->Double?,edit:@escaping(Double)->Void,drag:@escaping(Bool)->Void){values[id]=value;edits[id]=edit;drags[id]=drag}
 static func check(_ expected:String?){
  let visible=values.compactMap{key,value in value() == nil ? nil:key}.sorted()
  precondition(visible == expected.map{[$0]} ?? [],"Expected \(expected ?? "none"), got \(visible)")
 }
 static func enter(_ id:String){let r=frames[id]!;move?(CGPoint(x:r.midX,y:r.midY))}
}
@main @MainActor struct Main {
 static func main() throws {
  // The current pointer position wins, including relayout under a stationary
  // pointer. Drag release resolves the latest target, never a stale row exit.
  let selection=MenuHoverSelection()
  selection.updateFrames(["a":CGRect(x:0,y:0,width:100,height:50),"b":CGRect(x:0,y:52,width:100,height:50)])
  selection.move(to:CGPoint(x:10,y:25));precondition(selection.activeID=="a")
  selection.setDragging("a",active:true);selection.move(to:CGPoint(x:10,y:75));precondition(selection.activeID=="a")
  selection.setDragging("a",active:false);precondition(selection.activeID=="b")
  selection.updateFrames(["a":CGRect(x:0,y:52,width:100,height:50)]);precondition(selection.activeID=="a")
  selection.move(to:nil);precondition(selection.activeID==nil)
  let app=NSApplication.shared;app.setActivationPolicy(.prohibited)
  let model=Controller();model.serviceAvailable=true
  let json=#"{"id":"a","lastActivityAt":1700000000000,"name":"Hover fixture","model":"fixture","status":"idle","connected":true,"ambiguous":false,"observedWindow":720000,"policy":{"window":757895,"compact":646000,"reserve":16000,"retainedFloor":0,"revision":1,"enabled":true},"modelMetadata":{"max_context_window":872000,"effective_context_window_percent":95}}"#
  let ids=["a","b","c","d","e"]
  model.chats=try ids.map{id in try JSONDecoder().decode(Chat.self,from:Data(json.replacingOccurrences(of:"\"id\":\"a\"",with:"\"id\":\"\(id)\"").utf8))}
  let host=NSHostingView(rootView:ContextMenuView(model:model,openChat:{_ in},openSettings:{},quit:{}));host.sizingOptions=[]
  let window=NSPanel(contentRect:NSRect(x:0,y:0,width:400,height:model.contextMenuHeight),styleMask:[.borderless,.nonactivatingPanel],backing:.buffered,defer:false)
  window.contentView=host;window.display()
  Task{@MainActor in
   func settle() async {try? await Task.sleep(for:.milliseconds(25))}
   try? await Task.sleep(for:.milliseconds(250))
   precondition(HoverProbe.frames.count==5 && HoverProbe.move != nil)
   for _ in 0..<${rounds} {
    for id in ids+ids.reversed(){
     HoverProbe.enter(id);await settle();HoverProbe.check(id)
     precondition(HoverProbe.values[id]?()==720)
     HoverProbe.edits[id]?(600);await settle()
     let r=HoverProbe.frames[id]!
     HoverProbe.move?(CGPoint(x:r.midX,y:r.maxY+1));await settle();HoverProbe.check(nil)
    }
   }
   // Cross several rows within a single render pass; only the latest survives.
   for id in ids{HoverProbe.enter(id)}
   await settle();HoverProbe.check("e")
   HoverProbe.drags["e"]?(true);HoverProbe.enter("b");await settle();HoverProbe.check("e")
   precondition(model.menuDragInProgress)
   HoverProbe.drags["e"]?(false);await settle();HoverProbe.check("b")
   precondition(!model.menuDragInProgress)
   HoverProbe.move?(nil);await settle();HoverProbe.check(nil)
   // A row that receives model metadata after entry must retry without requiring exit.
   var raw=try! JSONSerialization.jsonObject(with:Data(json.utf8)) as! [String:Any]
   raw.removeValue(forKey:"modelMetadata")
   model.chats[0]=try! JSONDecoder().decode(Chat.self,from:JSONSerialization.data(withJSONObject:raw))
   await settle();HoverProbe.enter("a");await settle();HoverProbe.check(nil)
   model.chats[0]=try! JSONDecoder().decode(Chat.self,from:Data(json.utf8))
   await settle();HoverProbe.check("a")
   precondition(model.chats.allSatisfy{$0.policy?.window==757895})
   // Untouched drafts track new saved budgets; manual edits survive until bounds change.
   raw=try! JSONSerialization.jsonObject(with:Data(json.utf8)) as! [String:Any]
   var budget=raw["policy"] as! [String:Any];budget["window"]=736843;budget["revision"]=4;raw["policy"]=budget
   model.chats[0]=try! JSONDecoder().decode(Chat.self,from:JSONSerialization.data(withJSONObject:raw));await settle()
   precondition(HoverProbe.values["a"]?()==700,"Untouched draft must follow restored budget")
   HoverProbe.edits["a"]?(600);await settle();budget["window"]=757895;budget["revision"]=5;raw["policy"]=budget
   model.chats[0]=try! JSONDecoder().decode(Chat.self,from:JSONSerialization.data(withJSONObject:raw));await settle();precondition(HoverProbe.values["a"]?()==600)
   raw["modelMetadata"]=["max_context_window":1022223,"effective_context_window_percent":90,"context_ceiling":920000,"context_catalog_ready":true]
   budget["window"]=1022223;budget["compact"]=904000;raw["policy"]=budget
   model.chats[0]=try! JSONDecoder().decode(Chat.self,from:JSONSerialization.data(withJSONObject:raw));await settle();precondition(HoverProbe.values["a"]?()==920,"Mode changes must replace stale bounds and draft")
   print("${rounds*10} row visits, draft edits/exits, rapid crossing, drag lock, late metadata and budget restoration passed")
   app.terminate(nil)
  };app.run()
 }
}
`);
  const sources=fs.readdirSync(path.join(root,'macos')).filter(name=>name.endsWith('.swift')&&!['ContextControl.swift','ContextApplication.swift','ContextMenu.swift'].includes(name)).map(name=>path.join(root,'macos',name));
  const binary=path.join(temp,'probe');
  const build=spawnSync('xcrun',['swiftc','-parse-as-library','-target',`${process.arch==='arm64'?'arm64':'x86_64'}-apple-macos14.0`,...sources,path.join(temp,'Control.swift'),path.join(temp,'Menu.swift'),path.join(temp,'Main.swift'),'-o',binary,'-framework','SwiftUI','-framework','AppKit'],{encoding:'utf8',timeout:120000});
  assert.equal(build.status,0,build.error?.message||build.stderr);
  const run=spawnSync(binary,[],{encoding:'utf8',timeout:Math.max(15000,rounds*1000+5000)});
  assert.equal(run.status,0,run.stderr);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
