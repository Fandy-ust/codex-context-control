import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('native shortcuts reject typing keys, normalize aliases, retain old bindings and recover after recording',{skip:process.platform!=='darwin',timeout:60000},()=>{
 const repo=fileURLToPath(new URL('../',import.meta.url)),temp=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-shortcut-regression-'));
 try{
  const source=path.join(temp,'Main.swift'),binary=path.join(temp,'probe');
  fs.writeFileSync(source,String.raw`
import AppKit
import Carbon.HIToolbox
struct Fixture:Decodable {
 struct Pair:Decodable {let input:String;let normalized:String}
 let valid:[Pair];let invalid:[String]
}
@main @MainActor struct Probe {
 static func main() async throws {
  _=NSApplication.shared
  let fixture=try JSONDecoder().decode(Fixture.self,from:Data(contentsOf:URL(fileURLWithPath:CommandLine.arguments[1])))
  for row in fixture.valid{precondition(GlobalShortcutManager.normalized(row.input)==row.normalized.replacingOccurrences(of:"Super",with:"Command"),row.input)}
  for input in fixture.invalid{precondition(GlobalShortcutManager.normalized(input)==nil,input)}
  var triggered=0
  let a=GlobalShortcutManager(onTrigger:{triggered+=1}),b=GlobalShortcutManager(onTrigger:{}),other=GlobalShortcutManager(onTrigger:{})
  defer{a.dispose();b.dispose();other.dispose()}
  let first="Control+Alt+Shift+Command+9",second="Control+Alt+Shift+Command+8"
  precondition(a.configure(first,enabled:true).registered)
  var event:EventRef?
  precondition(CreateEvent(nil,UInt32(kEventClassKeyboard),UInt32(kEventHotKeyPressed),GetCurrentEventTime(),0,&event)==noErr)
  defer{if let event{ReleaseEvent(event)}}
  var identifier=EventHotKeyID(signature:0,id:1)
  precondition(SetEventParameter(event,EventParamName(kEventParamDirectObject),EventParamType(typeEventHotKeyID),MemoryLayout<EventHotKeyID>.size,&identifier)==noErr)
  precondition(a.handle(event!)==OSStatus(eventNotHandledErr))
  identifier.signature=0x4343_4D47
  precondition(SetEventParameter(event,EventParamName(kEventParamDirectObject),EventParamType(typeEventHotKeyID),MemoryLayout<EventHotKeyID>.size,&identifier)==noErr)
  precondition(a.handle(event!)==noErr)
  try await Task.sleep(for:.milliseconds(20));precondition(triggered==1,"The registered event must trigger the window action")
  precondition(a.configure("Cmd + SHIFT + Option + Ctrl + 9",enabled:true).registered)
  precondition(!b.configure(first,enabled:true).registered,"Equivalent spelling must not release the original hotkey")
  precondition(!a.configure("Shift+A",enabled:true).registered)
  precondition(!b.configure(first,enabled:true).registered,"Invalid input preserves the old binding")
  precondition(b.configure(second,enabled:true).registered)
  precondition(!a.configure(second,enabled:true).registered)
  precondition(!other.configure(first,enabled:true).registered,"An occupied replacement preserves the old binding")
  a.suspend(true)
  precondition(a.handle(event!)==OSStatus(eventNotHandledErr))
  precondition(other.configure(first,enabled:true).registered)
  let failed=a.suspend(false);precondition(!failed.registered && failed.error != nil,"A resume failure must be reported")
  other.dispose();precondition(a.suspend(false).registered);precondition(a.suspend(false).registered)
  precondition(!other.configure(first,enabled:true).registered,"Repeated resume retains one valid registration")
  var transitions:[Bool]=[]
  let recorder=ShortcutRecorder()
  recorder.onRecordingChanged={active in transitions.append(active);a.suspend(active)}
  recorder.start();precondition(recorder.isRecording)
  NotificationCenter.default.post(name:NSApplication.didResignActiveNotification,object:NSApplication.shared)
  try await Task.sleep(for:.milliseconds(30))
  precondition(!recorder.isRecording && transitions == [true,false])
  precondition(!other.configure(first,enabled:true).registered,"Switching applications restores the original key")
  recorder.start()
  NotificationCenter.default.post(name:NSWindow.didResignKeyNotification,object:nil)
  try await Task.sleep(for:.milliseconds(30))
  precondition(!recorder.isRecording && transitions == [true,false,true,false])
  recorder.start();recorder.stop();recorder.stop();precondition(transitions == [true,false,true,false,true,false])
  let cleared=a.configure("",enabled:false);precondition(!cleared.registered && cleared.error==nil)
  precondition(other.configure(first,enabled:true).registered,"Clear releases the shortcut")
  print("Native alias, invalid-key, replacement, suspension, focus-loss and clear regressions passed")
 }
}
`);
  const build=spawnSync('xcrun',['swiftc','-parse-as-library',...['GlobalShortcut.swift','ShortcutRecorder.swift','Localization.swift'].map(n=>path.join(repo,'macos',n)),source,'-o',binary,'-framework','AppKit','-framework','Carbon'],{encoding:'utf8',timeout:40000});assert.equal(build.status,0,build.stderr);
  const run=spawnSync(binary,[path.join(repo,'test/fixtures/contracts/shortcuts.json')],{env:{...process.env,CONTEXT_CONTROL_HOME:temp},encoding:'utf8',timeout:10000});assert.equal(run.status,0,run.stderr+run.stdout);assert.match(run.stdout,/regressions passed/);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
