import {test} from 'node:test';
import assert from 'node:assert/strict';
import {smoothQuotaChart} from '../src/core/quota-smoothing.mjs';
test('smoothing weights costs by percentage and preserves original hover values',()=>{
 const chart={points:[{x:1,y:1,costUSD:1,quotaPP:1,series:'a',segment:'a1'},{x:2,y:3,costUSD:9,quotaPP:3,series:'a',segment:'a1'},{x:3,y:20,costUSD:20,quotaPP:1,series:'a',segment:'a2'},{x:4,y:50,costUSD:50,quotaPP:1,series:'b',segment:'b1'}]};
 const result=smoothQuotaChart(chart,3);assert.equal(result.points[1].y,2.5);assert.equal(result.points[1].rawY,3);assert.equal(result.points[2].y,20);assert.equal(result.points[3].y,50);assert.equal(chart.points[1].y,3);assert.equal(smoothQuotaChart(chart,0),chart);
});
test('smoothing limits its window and rejects unsupported options',()=>{
 const result=smoothQuotaChart({points:[0,3,6,9].map((y,x)=>({x,y,series:'a'}))},3);
 assert.equal(result.points[3].y,6);assert.throws(()=>smoothQuotaChart({points:[]},4),/Invalid smoothing/);
});
