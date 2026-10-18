import test from 'node:test';
import assert from 'node:assert/strict';
import {quotaIntervals, buildQuotaAnalytics} from '../src/core/quota-analytics.mjs';
import {DAY, HOUR, fitLine, usageBetween} from '../src/core/quota-statistics.mjs';
import {quotaFixture} from '../desktop/quota-demo.mjs';
const now = Date.UTC(2026, 9, 18, 12), reset = Math.floor((now + DAY) / 1000);
const point = (at, used, extra = {}) => ({at, scope: 'history', bucket: 'codex', weeklyUsed: used, weeklyReset: reset, ...extra});
const request = (at, input, extra = {}) => ({id: String(at), at, input, output: 10, cached: 50, model: 'Sol', thread: 'a', ...extra});

test('model selection filters tokens and quota comparisons without attributing mixed intervals',()=>{
 const snapshots=Array.from({length:4},(_,i)=>point(now-(3-i)*600000,10+i));
 const requests=[request(now-1500000,100),request(now-1100000,200),request(now-900000,300,{model:'Luna'}),request(now-300000,400,{model:'Luna'})];
 const source={snapshots,requests},all=buildQuotaAnalytics(source,{now}),sol=buildQuotaAnalytics(source,{now,model:'Sol'}),luna=buildQuotaAnalytics(source,{now,model:'Luna'});
 const chart=(report,id)=>report.charts.find(p=>p.id===id);
 assert.deepEqual(sol.models.map(p=>p.id),['Luna','Sol']);assert.equal(sol.model,'Sol');
 assert.equal(sol.overview.tokens,320);assert.equal(luna.overview.tokens,720);
 assert.equal(chart(sol,'weekly-scatter').points.length,1);assert.equal(chart(sol,'weekly-scatter').points[0].tokens,110);
 assert.equal(chart(luna,'weekly-scatter').points.length,1);assert.equal(chart(luna,'weekly-scatter').points[0].tokens,410);
 assert.equal(chart(sol,'weekly-scatter').points[0].y,1);assert.equal(sol.overview.tokensPerPP,110);
 assert.deepEqual(chart(sol,'weekly').points,chart(all,'weekly').points);assert.equal(sol.overview.weeklyUsed,13);
 assert.deepEqual(sol.dashboard,all.dashboard);assert.equal(chart(sol,'weekly').modelScope,'account');
 assert.equal(chart(sol,'ranking').rows.find(p=>p.category==='chat').tokens,320);
 const absent=buildQuotaAnalytics(source,{now,model:'Missing'});
 assert.equal(absent.model,'Missing');assert.equal(absent.overview.tokens,null);assert.equal(absent.overview.tokensPerPP,null);
 assert.equal(chart(absent,'weekly-scatter').points.length,0);assert.equal(chart(absent,'ranking').rows.length,0);
 assert.ok(all.charts.every(p=>p.guide.length===2));
});
test('zero-rounded samples accumulate until a positive delta, without recounting cache or reasoning', () => {
 const s = [point(now - 1800000, 10), point(now - 1200000, 10), point(now - 600000, 11)];
 const r = [request(now - 1500000, 100), request(now - 900000, 200)];
 const result = quotaIntervals(s, r, 'weekly').intervals;
 assert.equal(result.length, 1);assert.equal(result[0].pp, 1);assert.equal(result[0].tokens, 320);assert.equal(result[0].cached, 100);
 assert.equal(usageBetween(r, now - 1500000, now).tokens, 210, 'left endpoint is excluded');
});
test('reset, missing windows, backwards snapshots and offline gaps cannot create usage deltas', () => {
 const s = [point(now - 4 * HOUR, 60), point(now - 3 * HOUR, 70), point(now - 3 * HOUR + 60000, 5), point(now - 3 * HOUR + 120000, 7, {weeklyReset: reset + 1}), point(now - 3 * HOUR + 180000, null)];
 assert.equal(quotaIntervals(s, [], 'weekly').intervals.length, 0);
 assert.equal(quotaIntervals(s, [], 'five').intervals.length, 0);
});
test('weekly changes crossing a 5h reset are excluded from window attribution', () => {
 const s = [point(now - 600000, 10, {fiveReset: reset, fiveUsed: 80}), point(now, 12, {fiveReset: reset + 18000, fiveUsed: 1})];
 const data = buildQuotaAnalytics({snapshots: s, requests: [request(now - 1, 100)]}, {now});
 assert.equal(data.charts.find(c => c.id === 'windows').points.length, 0);
 assert.equal(data.charts.find(c => c.id === 'weekly-scatter').points.length, 1);
});
test('pools and account observations stay separate and missing 5h data stays unavailable', () => {
 const s = [point(now - 600000, 10), point(now, 12), point(now, 90, {scope: 'other'}), point(now, 80, {bucket: 'other'})];
 const report = buildQuotaAnalytics({snapshots: s}, {now, scope: 'history', pool: 'codex'});
 assert.equal(report.overview.weeklyUsed, 12);assert.equal(report.overview.fiveUsed, null);
 assert.equal(report.charts.find(c => c.id === 'five-hour-scatter').points.length, 0);
 assert.equal(report.overview.tokens, null);assert.equal(report.overview.tokensPerPP, null);
});
test('the shared dashboard supports six main charts and all advanced views without invented chat quota attribution', () => {
 const fixture = quotaFixture(now), report = buildQuotaAnalytics(fixture, {now});
 assert.equal(report.sections[0].chartIds.length, 6);assert.equal(report.charts.length, 16);
 for (const id of report.sections[0].chartIds) assert.ok(report.charts.find(c => c.id === id).points.length, id);
 assert.ok(report.charts.find(c => c.id === 'weekly-scatter').fit);
 const ranking = report.charts.find(c => c.id === 'ranking');assert.ok(ranking.rows.length);assert.ok(ranking.rows.every(r => !Object.hasOwn(r, 'weeklyPP')));
 const repeat = buildQuotaAnalytics({...fixture, requests: [...fixture.requests, fixture.requests[0]]}, {now});
 assert.deepEqual(repeat.overview, report.overview);
});
test('a fit needs sufficient varying observations and never invents a fixed conversion', () => {
 assert.equal(fitLine([{x: 1, y: 1}, {x: 2, y: 2}]), null);
 assert.equal(fitLine([{x: 1, y: 1}, {x: 1, y: 2}, {x: 1, y: 3}]), null);
 assert.equal(fitLine([{x: 1, y: 3}, {x: 2, y: 2}, {x: 3, y: 1}]), null);
 assert.equal(fitLine([{x: 1, y: 1}, {x: 2, y: 2}, {x: 3, y: 3}]).r2, 1);
});
test('fractional quota changes accumulate for comparisons and zero-change periods still count local tokens', () => {
 const samples=Array.from({length:7},(_,i)=>point(now-(6-i)*300000,10+i*.2));
 const requests=Array.from({length:6},(_,i)=>request(now-(5-i)*300000-1,100+i*10));
 const report=buildQuotaAnalytics({snapshots:samples,requests},{now});
 assert.ok(report.charts.find(c=>c.id==='weekly-scatter').points.length>0);
 const flat=buildQuotaAnalytics({snapshots:samples.map(p=>({...p,weeklyUsed:10})),requests},{now});
 const cumulative=flat.charts.find(c=>c.id==='cumulative').points;
 assert.ok(cumulative.at(-1).y>0);assert.equal(cumulative.at(-1).rightY,0);
 assert.equal(flat.overview.tokensPerPP,null);
});
test('5h/weekly ratios use the same observed intervals when one quota stream is missing',()=>{
 const fiveReset=reset,base=now-1800000;
 const snapshots=[point(base,10,{fiveReset,fiveUsed:10}),point(base+600000,null,{fiveReset,fiveUsed:30}),point(base+1200000,11,{fiveReset,fiveUsed:40}),point(now,12,{fiveReset,fiveUsed:45})];
 const report=buildQuotaAnalytics({snapshots},{now});const ratio=report.charts.find(c=>c.id==='ratio').points;
 assert.equal(ratio.length,1);assert.equal(ratio[0].y,5);assert.equal(ratio[0].weeklyPP,1);assert.equal(ratio[0].fivePP,5);assert.equal(ratio[0].partial,true);
});
test('weekly-only accounts retain efficiency and weekly analysis without synthetic 5h windows',()=>{
 const fixture=quotaFixture(now);fixture.snapshots=fixture.snapshots.map(p=>({...p,fiveUsed:null,fiveReset:null}));
 const report=buildQuotaAnalytics(fixture,{now});
 for(const id of ['weekly','weekly-scatter','efficiency','weeks'])assert.ok(report.charts.find(c=>c.id===id).points.length,id);
 assert.equal(report.charts.find(c=>c.id==='efficiency').xLabel,'Weekly 周期');
 for(const id of ['windows','five-hour-scatter'])assert.equal(report.charts.find(c=>c.id===id).points.length,0,id);
});
test('rounded flat samples do not imply zero future consumption in the central projection',()=>{
 const snapshots=Array.from({length:61},(_,i)=>point(now-(60-i)*300000,10+Math.floor(i/12)));
 const report=buildQuotaAnalytics({snapshots},{now});const points=report.charts.find(c=>c.id==='forecast').points.filter(p=>p.series==='平均速度');
 assert.ok(points.length>1);assert.equal(points[0].y,15);assert.ok(points.at(-1).y>15);
 assert.ok(Math.abs((points[1].y-points[0].y)/points[1].x-1)<1e-9,'five points over five observed hours means one point per hour');
});

test('automatic selection uses comparable history without merging account identities; explicit selection stays explicit',()=>{
 const snapshots=[point(now-600000,10),point(now,12),point(now-600000,17,{scope:'current'}),point(now,17,{scope:'current'})];
 const input={snapshots,requests:[request(now-1,100)],currentScope:'current'};
 const auto=buildQuotaAnalytics(input,{now});assert.equal(auto.scope,'history');assert.equal(auto.selection.mode,'auto');assert.equal(auto.quality.snapshots,2);assert.equal(auto.quality.comparableIntervals,1);
 const manual=buildQuotaAnalytics(input,{now,scope:'current'});assert.equal(manual.scope,'current');assert.equal(manual.selection.mode,'manual');assert.equal(manual.quality.comparableIntervals,0);assert.match(manual.charts.find(c=>c.id==='weekly-scatter').empty,/尚未变化/);
 const tied=buildQuotaAnalytics({...input,snapshots:snapshots.map(p=>({...p,weeklyUsed:17}))},{now});assert.equal(tied.scope,'current');
});
test('reset countdown jitter is normalized per account and pool while actual resets remain separate',async()=>{
 const {normalizeQuotaCycles}=await import('../src/core/quota-observations.mjs');
 const snapshots=[point(now-1800000,10),point(now-1200000,11,{weeklyReset:reset+1}),point(now-600000,12,{weeklyReset:reset+2}),point(now,2,{weeklyReset:reset+604800})];
 const original=structuredClone(snapshots),report=buildQuotaAnalytics({snapshots,requests:[request(now-1500000,100),request(now-900000,200)]},{now});
 assert.deepEqual(snapshots,original);assert.equal(report.quality.comparableIntervals,2);assert.equal(report.quality.resetTimeAdjustments,2);assert.equal(report.charts.find(c=>c.id==='weeks').rows.length,2);
 const bounded=normalizeQuotaCycles([point(now,1),point(now,2,{weeklyReset:reset+50}),point(now,3,{weeklyReset:reset+100}),point(now,4,{scope:'other',weeklyReset:reset+1}),point(now,4,{bucket:'other',weeklyReset:reset+2})]).snapshots;
 assert.equal(bounded[1].weeklyReset,reset);assert.equal(bounded[2].weeklyReset,reset+100);assert.equal(bounded[3].weeklyReset,reset+1);assert.equal(bounded[4].weeklyReset,reset+2);
});
test('same-cycle offline gaps yield labelled net changes, without inventing hourly usage',()=>{
 const snapshots=[point(now-2*HOUR,10),point(now,13)];
 const report=buildQuotaAnalytics({snapshots,requests:[request(now-HOUR,1000)]},{now});
 const scatter=report.charts.find(c=>c.id==='weekly-scatter').points;
 assert.equal(scatter.length,1);assert.equal(scatter[0].y,3);assert.equal(scatter[0].tokens,1010);assert.equal(scatter[0].estimated,true);assert.equal(scatter[0].durationHours,2);
 assert.equal(report.charts.find(c=>c.id==='hours').points.length,0);assert.equal(report.charts.find(c=>c.id==='forecast').points.length,0);
 const resetReport=buildQuotaAnalytics({snapshots:[snapshots[0],{...snapshots[1],weeklyReset:reset+604800}],requests:[request(now-HOUR,1000)]},{now});assert.equal(resetReport.quality.comparableIntervals,0);
});
test('weekly-only reports omit every five-hour chart from navigation and retain useful statistics',()=>{
 const fixture=quotaFixture(now);fixture.snapshots=fixture.snapshots.map(p=>({...p,fiveUsed:null,fiveReset:null}));
 const report=buildQuotaAnalytics(fixture,{now});assert.deepEqual(report.capabilities,{weekly:true,fiveHour:false});assert.deepEqual(report.sections[0].chartIds,['weekly','weekly-scatter','efficiency','weeks']);
 for(const id of ['windows','five-hour-scatter','distribution','anomalies','ratio']){assert.ok(report.sections.every(s=>!s.chartIds.includes(id)));assert.equal(report.charts.find(c=>c.id===id).visible,false);}
});
