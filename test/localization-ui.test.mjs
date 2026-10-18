import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';

test('the actual native settings view switches English and Chinese without changing a chat budget',{skip:process.platform!=='darwin',timeout:120000},()=>{
 const repo=fileURLToPath(new URL('../',import.meta.url)),temp=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-language-ui-'));
 try{
  fs.mkdirSync(path.join(repo,'build'),{recursive:true});
  fs.writeFileSync(path.join(temp,'Control.swift'),fs.readFileSync(path.join(repo,'macos/ContextControl.swift'),'utf8').replace('@main @MainActor final class ContextControlApp','@MainActor final class ContextControlApp'));
  fs.writeFileSync(path.join(temp,'Main.swift'),String.raw`
import SwiftUI
import AppKit
import Vision
@main @MainActor struct Harness {
 static func capture(_ view:NSView,_ name:String) throws -> String {
  view.layoutSubtreeIfNeeded();view.display()
  let bitmap=view.bitmapImageRepForCachingDisplay(in:view.bounds)!;view.cacheDisplay(in:view.bounds,to:bitmap)
  try bitmap.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:CommandLine.arguments[1]+"/localization-ui-"+name+".png"))
  let request=VNRecognizeTextRequest();request.recognitionLevel = .accurate;request.recognitionLanguages=name=="zh" ? ["zh-Hans","en-US"]:["en-US","zh-Hans"];request.automaticallyDetectsLanguage=true
  try VNImageRequestHandler(cgImage:bitmap.cgImage!,options:[:]).perform([request])
  return (request.results ?? []).compactMap{$0.topCandidates(1).first?.string}.joined(separator:"\n")
 }
 static func main() throws {
  let app=NSApplication.shared;app.setActivationPolicy(.prohibited)
  try Localization.setChoice(.zh)
  let model=Controller(),raw:[String:Any]=[
   "id":"language-fixture","name":"Project title · 原文","model":"gpt-6-astra","connected":true,"ambiguous":false,"status":"idle","phase":"confirmed","message":"下一轮窗口已读回确认。",
   "observedWindow":920000,"expectedWindow":920000,"freshUsage":true,"revision":1,"lastUsage":["totalTokens":1000],
   "policy":["window":1022223,"compact":904000,"reserve":16000,"retainedFloor":0,"revision":1,"enabled":true],
   "modelMetadata":["max_context_window":1022223,"effective_context_window_percent":90,"context_ceiling":920000,"context_compact_ceiling":904000,"context_catalog_ready":true]]
  model.chats=[try JSONDecoder().decode(Chat.self,from:JSONSerialization.data(withJSONObject:raw))];model.selectedID="language-fixture";model.serviceAvailable=true;model.supportsQuotaAnalytics=true;model.bridgeCount=1;model.notice="已接入 Codex。";model.fill()
  model.sidebar=ChatSidebar(projects:[SidebarProject(id:"project-fixture",name:"Project group · 分组",roots:["/fixture/project"],threadIds:["language-fixture"]),SidebarProject(id:"empty-project",name:"Empty project",roots:[],threadIds:[])],standaloneThreadIds:[])
  let original=model.selected!.policy!
  let view=NSHostingView(rootView:ContentView(model:model).frame(width:1040,height:1100))
  let window=NSWindow(contentRect:NSRect(x:0,y:0,width:1040,height:1100),styleMask:[.borderless],backing:.buffered,defer:false);window.contentView=view;window.display()
  let panel=NSHostingView(rootView:MainControlPanelView(model:model))
  let panelWindow=NSWindow(contentRect:NSRect(x:0,y:0,width:760,height:560),styleMask:[.borderless],backing:.buffered,defer:false);panelWindow.contentView=panel;panelWindow.display()
  Task{@MainActor in
   do{
    try await Task.sleep(for:.milliseconds(350));model.setLanguage(.en);try await Task.sleep(for:.milliseconds(350))
    let english=try capture(view,"en"),panelEnglish=try capture(panel,"en-panel");precondition(english.contains("Compact now") && panelEnglish.contains("Account usage") && panelEnglish.contains("Language") && panelEnglish.contains("Global defaults") && english.contains("Context window") && english.contains("Context details") && english.contains("Task queue"),"English UI was not rendered: "+english+"\nSettings: "+panelEnglish)
    precondition(!english.contains("全局默认") && model.selected!.policy! == original)
    model.setLanguage(.zh);try await Task.sleep(for:.milliseconds(350));let chinese=try capture(view,"zh"),panelChinese=try capture(panel,"zh-panel")
    precondition(chinese.contains("手动压缩") && panelChinese.contains("账户额度") && panelChinese.contains("全局默认") && chinese.contains("应用") && chinese.contains("上下文详情") && chinese.contains("任务队列"),"Chinese UI did not refresh: "+chinese+"\nSettings: "+panelChinese)
    precondition(model.selected!.policy! == original && model.selected!.title=="Project title · 原文")
    print("English/Chinese native rendering, immediate switch, original chat title and unchanged budget passed")
    app.terminate(nil)
   }catch{print(error);exit(1)}
  }
  app.run()
 }
}
`);
  const sources=fs.readdirSync(path.join(repo,'macos')).filter(name=>name.endsWith('.swift')&&name!=='ContextControl.swift').map(name=>path.join(repo,'macos',name));
  const binary=path.join(temp,'check');let r=spawnSync('xcrun',['swiftc','-parse-as-library',...sources,path.join(temp,'Control.swift'),path.join(temp,'Main.swift'),'-o',binary,'-framework','SwiftUI','-framework','AppKit','-framework','Vision'],{encoding:'utf8',timeout:95000});assert.equal(r.status,0,r.stderr);
  const env={...process.env,CONTEXT_CONTROL_HOME:path.join(temp,'home'),CONTEXT_CONTROL_LOCALIZATION_FILE:path.join(repo,'src/locales/en.json')};
  r=spawnSync(binary,[path.join(repo,'build')],{env,encoding:'utf8',timeout:15000});assert.equal(r.status,0,r.stderr+r.stdout);assert.match(r.stdout,/unchanged budget passed/);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
