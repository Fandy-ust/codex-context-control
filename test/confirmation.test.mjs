import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileWindowConfirmation} from '../src/confirmation.mjs';

test('a fresh window after a model switch resolves a missing expectation without confirming stale policy data',()=>{
  const policy={window:700000,compact:600000,revision:3,enabled:true};
  const model={effective_context_window_percent:95,max_context_window:872000};
  const thread={phase:'awaiting_runtime_confirmation',expectedWindow:null,freshUsage:true,revision:3,configuredWindow:700000,observedWindow:665000};
  assert.deepEqual(reconcileWindowConfirmation(thread,policy,model),{expectedWindow:665000,phase:'confirmed',message:'模型切换后的实际窗口已读回确认。'});
  assert.equal(reconcileWindowConfirmation(thread,policy,{...model,effective_context_window_percent:100}).phase,'mismatch');
  for(const update of [{freshUsage:false},{revision:2},{configuredWindow:600000},{observedWindow:null},{phase:'reloading'},{expectedWindow:665000}])assert.deepEqual(reconcileWindowConfirmation({...thread,...update},policy,model),{});
  assert.deepEqual(reconcileWindowConfirmation(thread,{...policy,enabled:false},model),{});
  assert.deepEqual(reconcileWindowConfirmation(thread,policy,null),{});
  assert.deepEqual(reconcileWindowConfirmation(thread,policy,{...model,max_context_window:600000}),{});
});
