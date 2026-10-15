import test from 'node:test';
import assert from 'node:assert/strict';
import {tokenNumber,normalizePolicy,preflight} from '../src/policy.mjs';

const model={max_context_window:872000,effective_context_window_percent:95};
const idle={status:'idle',freshUsage:true,lastUsage:{totalTokens:300000}};
test('accepts useful units and rejects malformed, negative and unsafe numbers',()=>{
  assert.equal(tokenNumber('400K'),400000);assert.equal(tokenNumber('0.5M'),500000);
  for(const value of ['-1','400KK','Infinity','1e9',1.3,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>tokenNumber(value));
});
test('a 500K to 400K change has space for 300K plus reserve',()=>{
  const p=normalizePolicy({window:'400K',compact:'350K',reserve:'20K'});
  const result=preflight(idle,p,model);assert.equal(result.allowed,true);assert.equal(result.expectedWindow,380000);
});
test('shrinking below live use requires compaction, never silent application',()=>{
  const result=preflight(idle,normalizePolicy({window:'200K',compact:'160K'}),model);
  assert.equal(result.code,'needs_compaction');assert.equal(result.allowed,false);
});
test('100K retained plus 20K reserve cannot fit 100K raw window',()=>{
  assert.equal(preflight(idle,normalizePolicy({window:'100K',compact:'90K',reserve:'20K',retainedFloor:'100K'}),model).code,'below_retained_floor');
});
test('capacity alone is insufficient if the next compaction would already trigger',()=>{
  assert.equal(preflight(idle,normalizePolicy({window:'130K',compact:'130K',reserve:'20K',retainedFloor:'100K'}),model).code,'below_retained_floor');
});
test('missing usage and metadata are explicit unknowns',()=>{
  const p=normalizePolicy({window:'400K'});
  assert.equal(preflight({status:'idle'},p,model).code,'needs_observation');
  assert.equal(preflight(idle,p,null).code,'metadata_missing');
});
test('active turns wait and catalog maxima are not bypassed',()=>{
  assert.equal(preflight({...idle,status:'active'},normalizePolicy({window:'400K'}),model).code,'waiting_for_idle');
  assert.equal(preflight(idle,normalizePolicy({window:'1M'}),model).code,'above_catalog_maximum');
});
test('scope and opaque child sessions are not guessed',()=>{
  assert.throws(()=>normalizePolicy({window:'400K',scope:'body_after_prefix'}));
  assert.equal(preflight({...idle,canAcceptDirectInput:false},normalizePolicy({window:'400K'}),model).code,'unsupported_thread');
});
