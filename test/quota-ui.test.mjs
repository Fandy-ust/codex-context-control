import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {demoQuotaAnalytics} from '../desktop/quota-demo.mjs';
import {quotaAnalyticsView as renderQuotaAnalytics,quotaPointText} from '../desktop/renderer/quota-analytics.mjs';
import {depletionTimeText} from '../desktop/renderer/quota-outlook-view.mjs';
import {translate} from '../src/localization-core.mjs';
const quotaAnalyticsView=props=>renderQuotaAnalytics({outlookMetric:'remaining',outlookOverlay:false,...props});
const escape=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');

test('depletion time names today, tomorrow and later dates only for usable forecasts',()=>{
 const now=new Date(2026,9,22,10,0).getTime(),t=s=>s;
 const period={status:'ready',finishesBeforeReset:true,depletionAt:new Date(2026,9,22,14,30).getTime()};
 assert.match(depletionTimeText(period,t,now),/今天 14:30/);
 const english=JSON.parse(fs.readFileSync(new URL('../src/locales/en.json',import.meta.url),'utf8'));
 const englishText=depletionTimeText(period,s=>translate(s,english,'en').replace(/\{(\d+)\}/g,''),now);
 assert.equal(englishText,'Expected to run out today 14:30');
 assert.match(depletionTimeText({...period,depletionAt:new Date(2026,9,23,2,5).getTime()},t,now),/明天 02:05/);
 const later=depletionTimeText({...period,depletionAt:new Date(2026,10,2,17,15).getTime()},t,now);
 assert.match(later,/2026/);assert.match(later,/17:15/);assert.doesNotMatch(later,/今天|明天/);
 for(const status of ['stale','flat','insufficient','awaiting_reset','exhausted','unidentified'])assert.equal(depletionTimeText({...period,status},t,now),'');
 for(const depletionAt of [null,undefined,NaN,Infinity])assert.equal(depletionTimeText({...period,depletionAt},t,now),'');
 assert.equal(depletionTimeText({...period,finishesBeforeReset:false},t,now),'');
 const report=demoQuotaAnalytics();Object.assign(report.dashboard.periods[0],period);
 assert.match(renderQuotaAnalytics({report,e:escape,t}),/qa-depletion-time/);
});
test('web analytics renders the shared six-chart contract with escaped observation labels',()=>{
 const report=demoQuotaAnalytics();report.scopes[0].label='<script>unsafe</script>';
 const html=quotaAnalyticsView({report,analysisMode:'advanced',section:'overview',e:escape,t:s=>s});
 assert.equal((html.match(/data-qa-chart=/g)||[]).length,8);assert.equal((html.match(/data-action="qa-section"/g)||[]).length,4);
 assert.ok(!html.includes('<script>unsafe'));assert.ok(!html.includes('NaN'));assert.ok(!html.includes('Infinity'));
 for(const section of report.sections)assert.ok(quotaAnalyticsView({report,analysisMode:'advanced',section:section.id,e:escape,t:s=>s}).includes('data-qa-chart='));
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
  precondition(report.sections[0].chartIds.count==6 && report.charts.count==16 && report.dashboard?.periods.count==2)
  let model=Controller(),view=NSHostingView(rootView:QuotaAnalyticsView(model:model,onBack:{},fixture:report).frame(width:820,height:1000))
  let window=NSWindow(contentRect:NSRect(x:0,y:0,width:820,height:1000),styleMask:[.borderless],backing:.buffered,defer:false);window.contentView=view;window.display()
  Task{@MainActor in
   do{try await Task.sleep(for:.milliseconds(500));view.layoutSubtreeIfNeeded();view.display();let bitmap=view.bitmapImageRepForCachingDisplay(in:view.bounds)!;view.cacheDisplay(in:view.bounds,to:bitmap);try bitmap.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:CommandLine.arguments[2]));print("Native shared analytics report rendered")
    model.taskQueues=TaskQueuesState(sleepPrevented:false,queues:[ChatTaskQueue(id:"fixture",enabled:false,config:QueueConfig(),tasks:[QueueTask(id:"task",prompt:"完整任务：实现界面并运行测试",status:"waiting",error:nil)],revision:1,state:"off",message:"未开启监视")])
    let queueView=NSHostingView(rootView:TaskQueueDetailView(model:model,chatID:"fixture",onBack:{}).frame(width:820,height:1000));window.contentView=queueView;window.display();try await Task.sleep(for:.milliseconds(250));queueView.layoutSubtreeIfNeeded();queueView.display()
    let queueBitmap=queueView.bitmapImageRepForCachingDisplay(in:queueView.bounds)!;queueView.cacheDisplay(in:queueView.bounds,to:queueBitmap);try queueBitmap.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:CommandLine.arguments[2]+".queue.png"));print("Native task queue rendered");app.terminate(nil)}catch{print(error);exit(1)}
  };app.run()
 }
}`);
  const sources=fs.readdirSync(path.join(repo,'macos')).filter(n=>n.endsWith('.swift')&&n!=='ContextControl.swift'&&n!=='ContextApplication.swift').map(n=>path.join(repo,'macos',n));
  const binary=path.join(temp,'preview'),build=spawnSync('xcrun',['swiftc','-parse-as-library',...sources,path.join(temp,'Control.swift'),path.join(temp,'Main.swift'),'-o',binary,'-framework','SwiftUI','-framework','AppKit'],{encoding:'utf8',timeout:90000});assert.equal(build.status,0,build.stderr);
  const screenshot=process.env.CONTEXT_CONTROL_QUOTA_SCREENSHOT||path.join(temp,'analytics.png');
  const run=spawnSync(binary,[path.join(temp,'report.json'),screenshot],{env:{...process.env,CONTEXT_CONTROL_HOME:temp},encoding:'utf8',timeout:15000});assert.equal(run.status,0,run.stdout+run.stderr);assert.ok(fs.statSync(screenshot).size>5000);assert.ok(fs.statSync(screenshot+'.queue.png').size>5000);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});

test('weekly-only UI hides unsupported metrics and keeps Automatic selected across reports',async()=>{
 const {quotaFixture}=await import('../desktop/quota-demo.mjs'),{buildQuotaAnalytics}=await import('../src/core/quota-analytics.mjs');
 const fixture=quotaFixture();fixture.snapshots=fixture.snapshots.map(p=>({...p,fiveUsed:null,fiveReset:null}));
 const report=buildQuotaAnalytics(fixture),html=quotaAnalyticsView({report,analysisMode:'advanced',section:'overview',e:escape,t:s=>s});
 assert.equal((html.match(/data-qa-chart=/g)||[]).length,4);assert.equal((html.match(/class="qa-metric"/g)||[]).length,3);assert.ok(!html.includes('5h'));assert.match(html,/<option value="" selected>/);
 const manual=quotaAnalyticsView({report,analysisMode:'advanced',section:'overview',selectedScope:report.scope,e:escape,t:s=>s});assert.ok(!manual.match(/<select id="qa-scope">([\s\S]*?)<\/select>/)[1].includes('<option value="" selected>'));
});

test('advanced analysis keeps the selected model and displays reading guidance without raw data disclosures',()=>{
 const report=demoQuotaAnalytics({model:'gpt-6-sol'}),html=quotaAnalyticsView({report,analysisMode:'advanced',section:'overview',selectedModel:'gpt-6-sol',e:escape,t:s=>s});
 assert.match(html,/<select id="qa-model">/);assert.match(html,/<option value="gpt-6-sol" selected>/);
 assert.match(html,/图表说明/);assert.doesNotMatch(html,/class="qa-guide"/);assert.match(html,/qa-model-notice/);
 assert.doesNotMatch(html,/class="qa-note"|<summary>数据说明<\/summary>/);
});


test('one page shows predictions followed by advanced analysis without an entry button',()=>{
 const report=demoQuotaAnalytics(),html=quotaAnalyticsView({report,analysisMode:'advanced',e:escape,t:s=>s});
 assert.equal((html.match(/data-qa-period=/g)||[]).length,3);assert.equal((html.match(/data-qa-chart=/g)||[]).length,8);
 assert.ok(html.includes('预计提前'));assert.ok(html.includes('预计重置时还有'));assert.ok(html.includes('stroke-dasharray="6 4"'));
 assert.ok(html.includes('id="qa-days"'));assert.ok(html.includes('id="qa-model"'));assert.ok(html.includes('每 1% 每周额度对应 Token'));
 assert.ok(html.indexOf('data-qa-chart="outlook-five"')<html.indexOf('class="qa-analysis-heading'));
 assert.ok(html.indexOf('class="qa-analysis-heading')<html.indexOf('id="qa-model"'));
 assert.ok(!html.includes('返回预测'));assert.ok(!html.includes('data-section="summary"'));
 assert.ok(quotaAnalyticsView({report,analysisMode:'advanced',period:'weekly',e:escape,t:s=>s}).includes('data-qa-chart="outlook-weekly"'));
 report.dashboard.periods=report.dashboard.periods.filter(p=>p.id==='weekly');
 const weekly=quotaAnalyticsView({report,analysisMode:'advanced',e:escape,t:s=>s});assert.equal((weekly.match(/data-qa-period=/g)||[]).length,2);assert.ok(!weekly.split('class="qa-analysis-heading')[0].includes('5 小时'));
});

test('default graph shows cost per percent, centered cycle choices, six-cycle overlay and compact dates',()=>{
 const report=demoQuotaAnalytics(),html=renderQuotaAnalytics({report,e:escape,t:s=>s});
 assert.ok(html.indexOf('data-qa-chart="outlook-five"')<html.indexOf('data-qa-chart="outlook-cost-overlay-five"'));assert.match(html,/class="qa-chart-footer"/);assert.match(html,/data-qa-chart="outlook-cost-overlay-five"/);assert.match(html,/id="outlook-metric"/);assert.match(html,/id="outlook-overlay" checked/);assert.match(html,/value="6" selected/);
 assert.match(html,/>5hr<\/button>/);assert.match(html,/>Weekly<\/button>/);assert.match(html,/id="outlook-start"/);
 const chart=report.dashboard.periods[0].costOverlayChart;assert.equal(chart.cycleCount,6);assert.equal(new Set(chart.points.map(p=>p.series)).size,6);
 const text=quotaPointText({y:.000123,costUSD:.000246,quotaPP:2,intervalStart:1},chart,s=>s);assert.match(text,/0.000123/);assert.match(text,/0.000246/);
 const credit=renderQuotaAnalytics({report,period:'credits',e:escape,t:s=>s});assert.match(credit,/outlook-credits/);assert.doesNotMatch(credit,/id="outlook-overlay"/);
});
