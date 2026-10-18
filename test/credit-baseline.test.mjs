import test from 'node:test';
import assert from 'node:assert/strict';
import {observeCreditBalance,creditRemaining} from '../src/credit-baseline.mjs';

test('first observation sets the baseline and spending only lowers the ratio',()=>{
 let value=observeCreditBalance(null,'30000');assert.deepEqual(value,{last:30000,baseline:30000});
 value=observeCreditBalance(value,'15000');assert.equal(creditRemaining('15000',value),50);
 value=observeCreditBalance(value,'0');assert.equal(value.baseline,30000);assert.equal(creditRemaining('0',value),0);
});
test('every observed increase resets the baseline, including below a former peak',()=>{
 let value=observeCreditBalance(null,'100');value=observeCreditBalance(value,'40');value=observeCreditBalance(value,'60');
 assert.deepEqual(value,{last:60,baseline:60});assert.equal(creditRemaining('60',value),100);
 value=observeCreditBalance(JSON.parse(JSON.stringify(value)),'30');assert.equal(creditRemaining('30',value),50);
 assert.deepEqual(observeCreditBalance(value,null),value);assert.deepEqual(observeCreditBalance(value,'invalid'),value);
});
test('zero and damaged saved observations recover without NaN or negative progress',()=>{
 assert.equal(creditRemaining('0',observeCreditBalance(null,'0')),0);
 assert.deepEqual(observeCreditBalance({last:30,baseline:10},'20'),{last:20,baseline:20});
 assert.equal(creditRemaining('5',{baseline:10}),50);assert.equal(creditRemaining('30',{baseline:10}),100);
});
