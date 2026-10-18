import test from 'node:test';
import assert from 'node:assert/strict';
import {draftLimits,threadDraft,resizeDraft,policyForDraft} from '../src/ui-budget.mjs';
import {effectiveWindow} from '../src/budget.mjs';
test('UI drafts retain original ratios across thousands of resize events and exact readback',()=>{
  const model={max_context_window:1022223,effective_context_window_percent:90,context_ceiling:920000,context_compact_ceiling:904000};
  const original=threadDraft({modelMetadata:model,policy:{window:777778,compact:630000,reserve:16000,revision:3}});let d=original;
  for(let i=0;i<2000;i++)d=resizeDraft(d,200000+i%721*1000,model);
  d=resizeDraft(d,700000,model);assert.equal(d.compact,630000);assert.equal(d.expectedRevision,3);
  const p=policyForDraft(d,model);assert.equal(effectiveWindow(p.window,90),700000);assert.equal(p.compact,630000);
  d=resizeDraft(d,920000,model);assert.ok(d.compact<=904000);assert.equal(draftLimits(model,d.window,16000).maximum,920000);
});
test('UI submits exact K thresholds and preserves reserves without rounding the displayed ratio',()=>{
  for(let percent=1;percent<=100;percent++){
    const model={max_context_window:100000000,effective_context_window_percent:percent};
    const d={window:363000,compact:326000,reserve:16000,retainedFloor:0};
    if(draftLimits(model,d.window,d.reserve).compact<d.compact)continue;
    const p=policyForDraft(d,model);assert.equal(effectiveWindow(p.window,percent),363000);assert.equal(p.compact,326000);assert.equal(p.reserve,16000);
  }
  assert.equal(threadDraft({}),null);
  assert.throws(()=>policyForDraft({window:34000,compact:33000,reserve:16000,retainedFloor:0},{max_context_window:100000,effective_context_window_percent:95}),/压缩/);
});
