import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {demoQuotaAnalytics} from '../desktop/quota-demo.mjs';
import {quotaAnalyticsView} from '../desktop/renderer/quota-analytics.mjs';
const escape=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
test('web analytics renders the shared six-chart contract with escaped observation labels',()=>{
 const report=demoQuotaAnalytics();report.scopes[0].label='<script>unsafe</script>';
 const html=quotaAnalyticsView({report,e:escape,t:s=>s});
 assert.equal((html.match(/data-qa-chart=/g)||[]).length,6);assert.equal((html.match(/data-action="qa-section"/g)||[]).length,4);
 assert.ok(!html.includes('<script>unsafe'));assert.ok(!html.includes('NaN'));assert.ok(!html.includes('Infinity'));
 for(const section of report.sections)assert.ok(quotaAnalyticsView({report,section:section.id,e:escape,t:s=>s}).includes('data-qa-chart='));
});
test('native analytics decodes the shared report and renders without a service or real account',{skip:process.platform!=='darwin',timeout:120000},()=>{
 const repo=fileURLToPath(new URL('../',import.meta.url)),temp=fs.mkdtempSync(path.join(os.tmpdir(),'qa-native-ui-'));
 try {
  const report=demoQuotaAnalytics();fs.writeFileSync(path.join(temp,'report.json'),JSON.stringify(report));
  fs.writeFileSync(path.join(temp,'Control.swift'),fs.readFileSync(path.join(repo,'macos/ContextControl.swift'),'utf8').replace('@main @MainActor final class ContextControlApp','@MainActor final class ContextControlApp'));
  fs.writeFileSync(path.join(temp,'Main.swift'),String.raw`
import SwiftUI
import AppKit
@main @MainActor struct Harness {
 static func main() throws {
  let app=NSApplication.shared;app.setActivationPolicy(.prohibited);try Localization.setChoice(.zh)
  let report=try JSONDecoder().decode(QuotaAnalyticsReport.self,from:Data(contentsOf:URL(fileURLWithPath:CommandLine.arguments[1])))
  precondition(report.sections[0].chartIds.count==6 && report.charts.count==16)
  let model=Controller(),view=NSHostingView(rootView:QuotaAnalyticsView(model:model,onBack:{},fixture:report).frame(width:820,height:1000))
  let window=NSWindow(contentRect:NSRect(x:0,y:0,width:820,height:1000),styleMask:[.borderless],backing:.buffered,defer:false);window.contentView=view;window.display()
  Task{@MainActor in
   do{try await Task.sleep(for:.milliseconds(500));view.layoutSubtreeIfNeeded();view.display();let bitmap=view.bitmapImageRepForCachingDisplay(in:view.bounds)!;view.cacheDisplay(in:view.bounds,to:bitmap);try bitmap.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:CommandLine.arguments[2]));print("Native shared analytics report rendered");app.terminate(nil)}catch{print(error);exit(1)}
  };app.run()
 }
}`);
  const sources=fs.readdirSync(path.join(repo,'macos')).filter(n=>n.endsWith('.swift')&&n!=='ContextControl.swift').map(n=>path.join(repo,'macos',n));
  const binary=path.join(temp,'preview'),build=spawnSync('xcrun',['swiftc','-parse-as-library',...sources,path.join(temp,'Control.swift'),path.join(temp,'Main.swift'),'-o',binary,'-framework','SwiftUI','-framework','AppKit'],{encoding:'utf8',timeout:90000});assert.equal(build.status,0,build.stderr);
  const screenshot=process.env.CONTEXT_CONTROL_QUOTA_SCREENSHOT||path.join(temp,'analytics.png');
  const run=spawnSync(binary,[path.join(temp,'report.json'),screenshot],{env:{...process.env,CONTEXT_CONTROL_HOME:temp},encoding:'utf8',timeout:15000});assert.equal(run.status,0,run.stdout+run.stderr);assert.ok(fs.statSync(screenshot).size>5000);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});

test('weekly-only UI hides unsupported metrics and keeps Automatic selected across reports',async()=>{
 const {quotaFixture}=await import('../desktop/quota-demo.mjs'),{buildQuotaAnalytics}=await import('../src/core/quota-analytics.mjs');
 const fixture=quotaFixture();fixture.snapshots=fixture.snapshots.map(p=>({...p,fiveUsed:null,fiveReset:null}));
 const report=buildQuotaAnalytics(fixture),html=quotaAnalyticsView({report,e:escape,t:s=>s});
 assert.equal((html.match(/data-qa-chart=/g)||[]).length,4);assert.equal((html.match(/class="qa-metric"/g)||[]).length,3);assert.ok(!html.includes('5h'));assert.match(html,/<option value="" selected>/);
 const manual=quotaAnalyticsView({report,selectedScope:report.scope,e:escape,t:s=>s});assert.ok(!manual.includes('<option value="" selected>'));
});
