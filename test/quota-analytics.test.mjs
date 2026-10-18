import test from 'node:test';
import assert from 'node:assert/strict';
import {quotaIntervals, buildQuotaAnalytics} from '../src/core/quota-analytics.mjs';
import {DAY, HOUR, fitLine, usageBetween} from '../src/core/quota-statistics.mjs';
import {quotaFixture} from '../desktop/quota-demo.mjs';
const now = Date.UTC(2026, 9, 18, 12), reset = Math.floor((now + DAY) / 1000);
const point = (at, used, extra = {}) => ({at, scope: 'history', bucket: 'codex', weeklyUsed: used, weeklyReset: reset, ...extra});
const request = (at, input, extra = {}) => ({id: String(at), at, input, output: 10, cached: 50, model: 'Sol', thread: 'a', ...extra});
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
