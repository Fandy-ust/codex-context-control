import test from 'node:test';
import assert from 'node:assert/strict';
import {quotaIntroFrame,QUOTA_INTRO_MS} from '../src/core/quota-intro.mjs';
import {quotaIconBitmap} from '../desktop/quota-icon.mjs';

test('startup outlines from the bottom before filling, then exactly restores the quota icon',()=>{
  assert.deepEqual(quotaIntroFrame(0),{outline:0,fill:0,finished:false});
  assert.equal(quotaIntroFrame(900).outline,.5);assert.equal(quotaIntroFrame(1800).fill,0);
  assert.equal(quotaIntroFrame(2500).fill,.5);
  assert.deepEqual(quotaIntroFrame(1,true),quotaIntroFrame(QUOTA_INTRO_MS));
  for(const remaining of [null,0,25,74,100]){
    const first=quotaIconBitmap(remaining,{introElapsedMs:0}).bitmap;
    for(let y=0;y<21;y++)for(let x=0;x<32;x++)assert.equal(first[(y*32+x)*4+3],0);
    assert.deepEqual(quotaIconBitmap(remaining,{introElapsedMs:QUOTA_INTRO_MS}).bitmap,quotaIconBitmap(remaining).bitmap);
  }
});
