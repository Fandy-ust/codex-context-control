import test from 'node:test';
import assert from 'node:assert/strict';
import {quotaCostPercentage} from '../src/core/quota-cost-percentage.mjs';
import {quotaCycleOverlay} from '../src/core/quota-cycle-overlay.mjs';
import {buildQuotaOutlook} from '../src/core/quota-outlook.mjs';
import {HOUR,WEEK} from '../src/core/quota-statistics.mjs';
const start=1700000000000,end=start+HOUR,reset=Math.floor((start+5*HOUR)/1000);
const row=(minute,five,weekly=five)=>({at:start+minute*60000,fiveUsed:five,fiveReset:reset,weeklyUsed:weekly,weeklyReset:(start+WEEK)/1000});
const request=(id,minute,usd)=>({id,at:start+minute*60000,usd,input:100,output:10});
const chart=(rows,requests)=>quotaCostPercentage(rows,requests,{role:'five',start,end,timeAxis:'hours'});
test('costs accumulate through unchanged and fractional percentages without duplicate billing',()=>{
 const rows=[row(0,10),row(10,10),row(20,10.5),row(30,11)],requests=[request('a',5,1),request('b',15,2),request('c',25,3)];
 const result=chart(rows,[...requests,requests[0]]);assert.equal(result.points.length,1);assert.equal(result.points[0].y,6);assert.equal(result.points[0].quotaPP,1);assert.equal(result.points[0].intervalStart,start);
 assert.equal(chart([row(0,10),row(10,10.5)],requests).points.length,0);
});
test('unknown prices, missing requests, reset boundaries and observation gaps never become free or connected intervals',()=>{
 const rows=[row(0,10),row(10,11),row(20,12),row(30,13)],requests=[request('a',5,2),request('unknown',15,null),request('c',25,4)];
 const result=chart(rows,requests);assert.deepEqual(result.points.map(p=>p.y),[2,4]);assert.notEqual(result.points[0].segment,result.points[1].segment);
 assert.equal(chart([row(0,10),row(31,11)],[request('gap',20,4)]).points.length,0);
 assert.equal(chart([row(0,10),{...row(10,11),fiveReset:reset+1}],[request('reset',5,4)]).points.length,0);
 assert.equal(chart([row(0,10),row(10,11)],[]).points.length,0);
});
test('5h and weekly use their own percentage denominators with account-isolated observations',()=>{
 const scope='account:test',snapshots=[row(0,10,10),row(10,12,11)].map(p=>({...p,scope,bucket:'codex'}));
 const dashboard=buildQuotaOutlook([...snapshots,...snapshots.map(p=>({...p,scope:'account:other',fiveUsed:90}))],{currentScope:scope,now:start+10*60000,requests:[request('a',5,6)]});
 assert.equal(dashboard.periods[0].costChart.points[0].y,3);assert.equal(dashboard.periods[1].costChart.points[0].y,6);
});
test('overlay aligns six newest real cycles at zero, and historical dates select the compared cycles',()=>{
 const duration=5*HOUR,rows=[],requests=[];
 for(let i=0;i<8;i++){const begin=start+i*duration;for(let j=0;j<2;j++)rows.push({at:begin+HOUR+j*600000,fiveReset:(begin+duration)/1000,fiveUsed:10+j});requests.push({id:'cycle-'+i,at:begin+HOUR+300000,usd:i+1});}
 const result=quotaCycleOverlay(rows,requests,{role:'five',duration,now:start+8*duration});
 assert.equal(result.chart.cycleCount,6);assert.equal(result.chart.xMin,0);assert.equal(result.chart.xMax,duration);assert.equal(result.costChart.points.length,6);assert.ok(result.costChart.points.every(p=>p.x===HOUR+600000));assert.deepEqual(result.costChart.points.map(p=>p.y),[3,4,5,6,7,8]);
 const historical=quotaCycleOverlay(rows,requests,{role:'five',duration,count:6,start:start+duration,end:start+3*duration,now:start+8*duration});
 assert.equal(historical.chart.cycleCount,2);assert.deepEqual(historical.costChart.points.map(p=>p.y),[2,3]);assert.equal(historical.chart.rangeStart,start+duration);
});
