import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {allowedLoginNavigation} from '../src/core/account-login-navigation.mjs';
import {configureAccountBrowser} from '../desktop/account-browser-controls.mjs';

const authorization='https://auth.openai.com/authorize?redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback';
const cases=[
 ['https://auth.openai.com/log-in','main',true],
 ['https://auth0.openai.com/authorize','main',true],
 ['https://accounts.google.com/signin','popup',true],
 ['https://login.microsoftonline.com/common/oauth2','popup',true],
 ['https://appleid.apple.com/auth/authorize','popup',true],
 ['https://sentinel.openai.com/frame.html','frame',true],
 ['https://challenges.cloudflare.com/turnstile/','frame',true],
 ['https://www.google.com/recaptcha/','frame',true],
 ['https://fpt.live.com/','frame',true],['https://iframe.arkoselabs.com/','frame',true],['https://sc.imp.live.com/','frame',true],
 ['https://fpt.live.com/','main',false],['https://iframe.arkoselabs.com.evil.test/','frame',false],
 ['https://sentinel.openai.com/frame.html','main',false],
 ['https://challenges.cloudflare.com/','popup',false],
 ['about:blank','frame',true],['about:srcdoc','frame',true],['about:blank','popup',true],['about:blank','main',false],
 ['https://sentinel.openai.com.evil.test/','frame',false],['https://accounts.google.com.evil.test/','popup',false],
 ['javascript:alert(1)','frame',false],['file:///private','popup',false],['data:text/html,test','frame',false],
 ['https://user:secret@auth.openai.com/','main',false],['http://localhost:1455/auth/callback?code=fixture','main',true],
 ['http://localhost:9999/','main',false],['http://192.168.1.1/','frame',false]
];
test('email verification frames and popup placeholders work without expanding top-level destinations',()=>{
 for(const [url,kind,expected] of cases)assert.equal(allowedLoginNavigation(url,authorization,{kind}),expected,`${kind} ${url}`);
 assert.equal(allowedLoginNavigation('about:blank',authorization,{kind:'popup',source:'https://evil.test'}),false);
 assert.equal(allowedLoginNavigation('about:srcdoc',authorization,{kind:'frame',source:'https://sentinel.openai.com'}),true);
});
function browser(){const web=new EventEmitter();web.getURL=()=>authorization;web.setWindowOpenHandler=handler=>{web.open=handler;};return {webContents:web};}
test('Electron preserves native popup creation and recursively applies isolated navigation controls',()=>{
 const root=browser(),child=browser(),session={},problems=[],children=[];root.webContents.session=session;
 const options={popupOptions:opener=>({webPreferences:{session:opener.webContents.session,nodeIntegration:false}}),onProblem:w=>problems.push(w),onChild:w=>children.push(w)};
 configureAccountBrowser(root,authorization,options);
 const popup=root.webContents.open({url:'about:blank'});
 assert.equal(popup.action,'allow');assert.equal(popup.overrideBrowserWindowOptions.webPreferences.session,session);
 assert.equal(root.webContents.open({url:'https://accounts.google.com/signin'}).action,'allow');
 root.webContents.emit('did-create-window',child);assert.deepEqual(children,[child]);
 assert.equal(child.webContents.open({url:'file:///tmp/no'}).action,'deny');assert.deepEqual(problems,[child]);
});
test('Electron frame policy permits verification, blocks unexpected navigation and surfaces load failure',()=>{
 const window=browser(),problems=[];configureAccountBrowser(window,authorization,{popupOptions:()=>({}),onProblem:(w,issue)=>problems.push({window:w,kind:issue?.kind})});
 const event=(url,isMainFrame)=>({url,isMainFrame,preventDefault(){this.prevented=true;}});
 const frame=event('https://challenges.cloudflare.com/frame',false);window.webContents.emit('will-frame-navigate',frame);assert.equal(frame.prevented,undefined);
 const main=event(frame.url,true);window.webContents.emit('will-frame-navigate',main);assert.equal(main.prevented,true);assert.equal(problems[0].kind,'main');
 const untrusted=event('https://untrusted.test/frame',false);window.webContents.emit('will-frame-navigate',untrusted);assert.equal(untrusted.prevented,true);assert.equal(problems[1].kind,'frame');
 window.webContents.emit('did-fail-load',{},-3,'cancelled','',true);assert.equal(problems.length,2);
 window.webContents.emit('did-fail-load',{},-105,'failed','',true);assert.equal(problems.length,3);
});

test('native browser preserves email interaction, iframe scripts, popup opener and shared navigation policy',{skip:process.platform!=='darwin',timeout:120000},()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'account-browser-'));
 try{
  const source=path.join(dir,'Harness.swift'),binary=path.join(dir,'check');
  fs.writeFileSync(path.join(dir,'cases.json'),JSON.stringify(cases));
  fs.writeFileSync(source,String.raw`
import AppKit
import WebKit
func L(_ value:String)->String {value}
@main @MainActor struct Harness {
 static func main() throws {
  let app=NSApplication.shared;app.setActivationPolicy(.prohibited)
  let authorization=URL(string:"https://auth.openai.com/authorize?redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback")!
  let rows=try JSONSerialization.jsonObject(with:Data(contentsOf:URL(fileURLWithPath:CommandLine.arguments[1]))) as! [[Any]]
  for row in rows{let kind:AccountLoginNavigation.Kind=(row[1] as! String)=="frame" ? .frame:((row[1] as! String)=="popup" ? .popup:.main);precondition(AccountLoginNavigation.allowed(URL(string:row[0] as! String)!,authorization:authorization,kind:kind)==(row[2] as! Bool),"Policy mismatch: "+(row[0] as! String))}
  let browser=AccountLoginBrowser(authorization)
  browser.window!.contentView!.layoutSubtreeIfNeeded()
  precondition(browser.web.frame.height>500 && browser.web.frame.width>500,"Web content must fill its visible input area")
  let html="""
  <html><body><input id="email" type="email"><button id="continue">Continue</button><iframe srcdoc="<script>parent.postMessage('frame-ready','*')</script>"></iframe><script>
  window.result='';window.frameReady=false;
  addEventListener('message',event=>{if(event.data==='frame-ready')window.frameReady=true;if(event.data==='popup-ok')window.result='passed';});
  document.getElementById('continue').onclick=()=>{if(!window.frameReady||document.getElementById('email').value!=='fixture@example.test')return;const popup=window.open('about:blank','login');if(!popup){window.result='popup-blocked';return;}popup.document.write('<script>window.opener.postMessage("popup-ok","*");window.close();<'+'/script>');};
  </script></body></html>
  """
  browser.web.loadHTMLString(html,baseURL:URL(string:"https://auth.openai.com/log-in")!)
  Task{@MainActor in
   do{
    for _ in 0..<100{if (try? await browser.web.evaluateJavaScript("window.frameReady")) as? Bool == true{break};try await Task.sleep(for:.milliseconds(100))}
    _ = try await browser.web.evaluateJavaScript("document.getElementById('email').value='fixture@example.test';document.getElementById('continue').click();true")
    var passed=false
    for _ in 0..<100{if (try? await browser.web.evaluateJavaScript("window.result")) as? String == "passed"{passed=true;break};try await Task.sleep(for:.milliseconds(100))}
    precondition(passed,"Email continuation, verification frame and popup opener must complete")
    browser.close();print("Native email, verification frame, popup and policy checks passed");app.terminate(nil)
   }catch{print(error);exit(1)}
  }
  app.run()
 }
}
`);
  const compiled=spawnSync('xcrun',['swiftc','-parse-as-library',path.resolve('macos/AccountLoginBrowser.swift'),source,'-o',binary,'-framework','AppKit','-framework','WebKit'],{encoding:'utf8',timeout:80000});assert.equal(compiled.status,0,compiled.stderr);
  const result=spawnSync(binary,[path.join(dir,'cases.json')],{encoding:'utf8',timeout:25000});assert.equal(result.status,0,JSON.stringify({signal:result.signal,error:result.error?.message,stdout:result.stdout,stderr:result.stderr}));assert.match(result.stdout,/Native email/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
