import test from 'node:test';
import assert from 'node:assert/strict';
import {quotaIconBitmap} from '../desktop/quota-icon.mjs';

test('startup, offline, stale and exhausted quotas always draw bars and a label',()=>{
  for(const remaining of [null,0,25,74,100])for(const stale of [false,true])for(const dark of [false,true]){
    const {bitmap}=quotaIconBitmap(remaining,{stale,dark});
    const coverage=(start,end)=>{let sum=0;for(let y=start;y<end;y++)for(let x=0;x<32;x++)sum+=bitmap[(y*32+x)*4+3];return sum;};
    assert.ok(coverage(0,21)>0);assert.ok(coverage(25,30)>0);
  }
});
