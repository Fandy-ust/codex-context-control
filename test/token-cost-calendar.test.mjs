import test from 'node:test';
import assert from 'node:assert/strict';
import {tokenCostCalendar} from '../src/core/token-cost-calendar.mjs';
import {buildQuotaAnalytics} from '../src/core/quota-analytics.mjs';
import {costCalendarView} from '../desktop/renderer/cost-calendar.mjs';
const now=Date.parse('2026-10-19T01:30:00Z');
const row=(id,at,extra={})=>({id,at:Date.parse(at),input:100,output:10,usd:1.25,model:'Sol',...extra});
const requests=[row('a','2026-10-18T16:30:00Z'),row('b','2026-10-19T00:30:00Z',{usd:null}),row('c','2026-10-18T15:30:00Z',{usd:0}),row('old','2026-01-01T12:00:00Z',{model:'Luna'}),row('future','2026-10-20T12:00:00Z')];
const options={now,timeZone:'Asia/Taipei'};
test('cost calendar uses local days, includes unpriced tokens without inventing zero cost, and deduplicates',()=>{
 const c=tokenCostCalendar([...requests,requests[0]],options);
 assert.equal(c.today,'2026-10-19');assert.equal(c.daily.length,365);assert.equal(c.hourly.length,24);assert.equal(c.monthly.length,12);
 assert.deepEqual(c.daily.at(-1),{date:'2026-10-19',tokens:220,requests:2,priced:1,unpriced:1,usd:1.25});
 assert.equal(c.hourly[0].usd,1.25);assert.equal(c.hourly[8].usd,null);assert.equal(c.hourly[8].unpriced,1);
 assert.equal(c.daily.at(-2).usd,0);assert.equal(c.daily.at(-3).usd,null);assert.equal(c.daily.at(-3).requests,0);
 assert.equal(c.monthly.at(-1).usd,1.25);assert.equal(c.daily.reduce((n,p)=>n+p.requests,0),4);
});
test('yearly cost history survives the advanced 4-week range and follows the model filter',()=>{
 const all=buildQuotaAnalytics({requests},options),luna=buildQuotaAnalytics({requests},{...options,model:'Luna'});
 assert.equal(all.costCalendar.daily.find(p=>p.date==='2026-01-01').usd,1.25);
 assert.equal(luna.costCalendar.daily.at(-1).requests,0);assert.equal(luna.costCalendar.daily.find(p=>p.date==='2026-01-01').requests,1);
 assert.ok(all.models.some(p=>p.id==='Luna'));
});
test('heatmap and line modes expose daily/monthly costs and retain missing-data gaps',()=>{
 const c=tokenCostCalendar(requests,options),context={e:String,t:String,renderChart:c=>JSON.stringify(c)};
 assert.match(costCalendarView(c,'year',context),/cost-cells year/);
 const line=costCalendarView(c,'year',{...context,mode:'line'});assert.match(line,/2026-01/);assert.match(line,/最近 12 个月/);assert.match(line,/"kind":"line"/);
 assert.match(costCalendarView(c,'day',context),/00:00/);assert.match(costCalendarView(c,'month',context),/10-19/);
});

test('historical date selection and exact time ranges use the same records for hourly, daily and monthly totals',()=>{
 const day=tokenCostCalendar(requests,{...options,costDate:'2026-10-18'});
 assert.equal(day.selectedDate,'2026-10-18');assert.equal(day.daily.at(-1).date,'2026-10-18');assert.equal(day.hourly[23].usd,0);assert.equal(day.hourly[0].requests,0);
 const range=tokenCostCalendar(requests,{...options,costDate:'2026-10-19',costStart:Date.parse('2026-10-18T16:30:00Z'),costEnd:Date.parse('2026-10-19T00:30:00Z')});
 assert.equal(range.customRange,true);assert.equal(range.daily.length,1);assert.equal(range.daily[0].requests,1);assert.equal(range.hourly.reduce((n,p)=>n+p.requests,0),1);assert.equal(range.monthly[0].usd,1.25);
});
