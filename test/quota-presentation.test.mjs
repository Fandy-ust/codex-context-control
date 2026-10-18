import test from 'node:test';
import assert from 'node:assert/strict';
import {quotaReliability,annotateQuotaCharts} from '../src/core/quota-analysis-presentation.mjs';
import {demoQuotaAnalytics} from '../desktop/quota-demo.mjs';
import {quotaAnalyticsView} from '../desktop/renderer/quota-analytics.mjs';
test('simple mode keeps practical charts while advanced mode exposes statistical charts with collapsed guidance',()=>{
 const report=demoQuotaAnalytics(),render=mode=>quotaAnalyticsView({report,analysisMode:mode,e:String,t:String});
 const simple=render('simple'),advanced=render('advanced');
 assert.match(simple,/data-qa-chart="ranking"/);assert.doesNotMatch(simple,/data-qa-chart="weekly-scatter"|data-action="qa-section"/);
 assert.match(advanced,/data-qa-chart="weekly-scatter"/);assert.match(advanced,/class="qa-help"/);assert.doesNotMatch(advanced,/class="qa-guide"|怎么看这张图/);
 assert.match(advanced,/<details class="qa-technical"><summary>技术详情/);assert.match(advanced,/可信程度有限|数据不足/);
});
test('uncertain conversion ratios never get a stable label from small, incomplete or dispersed samples',()=>{
 const stable=Array.from({length:20},()=>({tokens:1000,pp:1}));
 assert.equal(quotaReliability(stable.slice(0,4)).level,'insufficient');assert.equal(quotaReliability(stable,{pending:1}).level,'limited');assert.equal(quotaReliability(stable,{unknownAccount:true}).level,'limited');
 assert.equal(quotaReliability(stable).level,'consistent');assert.equal(quotaReliability(stable.map((p,i)=>({...p,tokens:i*1000+1}))).level,'limited');
 const charts=[{id:'weekly-scatter',fit:{count:30,r2:0}},{id:'five-hour-scatter'}];annotateQuotaCharts(charts);for(const chart of charts)assert.equal(chart.interpretation,'目前 Token 数量无法可靠预测额度消耗');
});
