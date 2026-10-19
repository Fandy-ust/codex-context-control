import test from 'node:test';
import assert from 'node:assert/strict';
import {buildQuotaAnalytics} from '../src/core/quota-analytics.mjs';
import {HOUR,DAY} from '../src/core/quota-statistics.mjs';
const now=Date.UTC(2026,9,18,12),currentScope='account:test';
function input({fiveRate=20,weeklyRate=1,fiveUsed=60,weeklyUsed=20}={}){
 const snapshots=Array.from({length:19},(_,i)=>{const age=(18-i)/12;return {scope:currentScope,bucket:'codex',at:now-age*HOUR,fiveUsed:fiveUsed-age*fiveRate,fiveReset:(now+HOUR)/1000,weeklyUsed:weeklyUsed-age*weeklyRate,weeklyReset:(now+2*DAY)/1000};});
 return {snapshots,currentScope};
}
const outlook=data=>buildQuotaAnalytics(data,{now}).dashboard;
test('5h and weekly independently report usage time and leftovers at their own reset',()=>{
 const periods=outlook(input()).periods,five=periods.find(p=>p.id==='five'),weekly=periods.find(p=>p.id==='weekly');
 assert.equal(five.status,'ready');assert.equal(five.remainingPercent,40);assert.equal(five.hoursRemaining,2);assert.equal(five.projectedRemaining,20);assert.equal(five.finishesBeforeReset,false);
 assert.equal(weekly.ratePerHour,1);assert.equal(weekly.hoursRemaining,80);assert.equal(weekly.projectedRemaining,32);assert.equal(weekly.hoursUntilReset,48);
 assert.equal(five.chart.points.at(-1).x,five.resetAt);assert.equal(five.chart.points.at(-1).y,20);assert.equal(weekly.chart.points.at(-1).y,32);
});
test('exhaustion is capped at zero and projection ends before reset without adding another allowance',()=>{
 const five=outlook(input({fiveRate:40,fiveUsed:80})).periods[0];
 assert.equal(five.hoursRemaining,.5);assert.equal(five.finishesBeforeReset,true);assert.equal(five.hoursBeforeReset,.5);assert.equal(five.projectedRemaining,0);
 assert.equal(five.chart.points.at(-1).x,now+.5*HOUR);assert.ok(five.chart.points.every(p=>p.y>=0&&p.y<=100));
 const exact=outlook(input({fiveUsed:80})).periods[0];assert.equal(exact.hoursBeforeReset,0);assert.equal(exact.projectedRemaining,0);
});
test('current account outlook is independent of useful but unidentified advanced history',()=>{
 const live=input(),history=live.snapshots.map(p=>({...p,scope:'history',fiveUsed:95,weeklyUsed:95}));
 const report=buildQuotaAnalytics({...live,snapshots:[...history,...live.snapshots]},{now,scope:'history'});
 assert.equal(report.scope,'history');assert.equal(report.dashboard.periods[0].remainingPercent,40);
 const none=outlook({snapshots:history});assert.deepEqual(none.periods,[]);
 const unknown=outlook({currentScope:'unidentified',snapshots:live.snapshots.map(p=>({...p,scope:'unidentified'}))});assert.equal(unknown.periods[0].status,'unidentified');assert.equal(unknown.periods[0].hoursRemaining,null);
});
test('the latest account capability determines visible cycles, with no historical phantom 5h',()=>{
 const data=input();data.snapshots.at(-1).fiveUsed=null;data.snapshots.at(-1).fiveReset=null;
 assert.deepEqual(outlook(data).periods.map(p=>p.id),['weekly']);
 const fiveOnly=input();for(const p of fiveOnly.snapshots){p.weeklyUsed=null;p.weeklyReset=null;}
 assert.deepEqual(outlook(fiveOnly).periods.map(p=>p.id),['five']);
});
test('stale, expired, flat and newly reset readings never fabricate a depletion time',()=>{
 const stale=input();stale.snapshots=stale.snapshots.map(p=>({...p,at:p.at-HOUR}));assert.ok(outlook(stale).periods.every(p=>p.status==='stale'&&p.hoursRemaining===null));
 const expired=input();for(const p of expired.snapshots)p.fiveReset=(now-1000)/1000;assert.equal(outlook(expired).periods[0].status,'awaiting_reset');
 const flat=outlook(input({fiveRate:0,weeklyRate:0}));assert.ok(flat.periods.every(p=>p.status==='flat'&&p.finishesBeforeReset===null));
 const reset=input();reset.snapshots.at(-1).fiveReset+=18000;reset.snapshots.at(-1).fiveUsed=1;assert.equal(outlook(reset).periods[0].status,'insufficient');
 const down=input();down.snapshots.at(-1).weeklyUsed=1;assert.equal(outlook(down).periods[1].status,'insufficient');
});
test('short 5h observations can predict while weekly waits, and long gaps break the pace estimate',()=>{
 const data=input();data.snapshots=data.snapshots.slice(-4);const periods=outlook(data).periods;
 assert.equal(periods[0].status,'ready');assert.equal(periods[1].status,'insufficient');
 const gap=input();gap.snapshots=gap.snapshots.filter((p,i)=>i<3||i===18);assert.ok(outlook(gap).periods.every(p=>p.status==='insufficient'));
 assert.equal(new Set(outlook(gap).periods[0].chart.points.map(p=>p.segment)).size,2);
});
test('rounded unchanged readings count elapsed time rather than ignoring idle intervals',()=>{
 const data=input();for(let i=0;i<data.snapshots.length;i++)data.snapshots[i].fiveUsed=10+Math.floor(i/6);
 const five=outlook(data).periods[0];assert.equal(five.ratePerHour,2);assert.equal(five.remainingPercent,87);
});
test('account changes and explicit pools keep independent predictions',()=>{
 const data=input(),other=data.snapshots.map(p=>({...p,scope:'account:other',fiveUsed:90,weeklyUsed:90}));
 const reports=outlook({...data,snapshots:[...data.snapshots,...other],currentScope:'account:other'});assert.equal(reports.periods[0].remainingPercent,10);assert.equal(reports.periods[0].status,'flat');
 const pooled=buildQuotaAnalytics({...data,snapshots:[...data.snapshots,...data.snapshots.map(p=>({...p,bucket:'review',fiveUsed:99}))]},{now,pool:'review'}).dashboard;
 assert.equal(pooled.pool,'review');assert.equal(pooled.periods[0].remainingPercent,1);assert.equal(pooled.periods[0].status,'flat');
});


test('one reading displays within the complete reset cycle and each observed percentage survives sampling',()=>{
 const data=input();data.snapshots=data.snapshots.slice(-1);const one=outlook(data);
 assert.equal(one.periods[0].chart.points.length,1);
 assert.equal(one.periods[0].chart.xMin,one.periods[0].resetAt-5*HOUR);
 assert.equal(one.periods[1].chart.xMin,one.periods[1].resetAt-7*DAY);
 const dense=input();dense.snapshots=Array.from({length:8},(_,i)=>({...dense.snapshots.at(-1),at:now-(7-i)*10000,weeklyUsed:10+i}));
 assert.equal(outlook(dense).periods[1].chart.points.length,8);
});
test('historical ranges show actual readings without forecasts and Credits remain balances',()=>{
 const data=input();data.snapshots.forEach((p,i)=>p.credits=180-i);
 const start=now-HOUR,end=now-HOUR/2;
 const dashboard=buildQuotaAnalytics(data,{now,outlookStart:start,outlookEnd:end}).dashboard;
 assert.equal(dashboard.customRange,true);assert.equal(dashboard.periods[0].chart.xMin,start);assert.equal(dashboard.periods[0].chart.xMax,end);
 assert.ok(dashboard.periods[0].chart.points.every(p=>!p.projected&&p.x>=start&&p.x<=end));
 assert.equal(dashboard.credits.balance,162);assert.ok(dashboard.credits.chart.points.every(p=>p.y>100));
 const creditOnly=outlook({currentScope,snapshots:[{scope:currentScope,bucket:'codex',at:now,credits:150}]});
 assert.equal(creditOnly.periods.length,0);assert.equal(creditOnly.credits.chart.points.length,1);
 assert.throws(()=>buildQuotaAnalytics(data,{now,outlookStart:end,outlookEnd:start}));
});
