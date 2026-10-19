import {savedBudget} from './budget.mjs';

// A model switch can clear the bridge expectation after a successful reload.
// Confirm only the window from a fresh report tied to the same applied policy.
export function reconcileWindowConfirmation(thread,policy,model){
  if(thread.phase!=='awaiting_runtime_confirmation'||thread.expectedWindow!=null||!thread.freshUsage||
    !policy?.enabled||thread.revision!==policy.revision||thread.configuredWindow!==policy.window||
    !Number.isSafeInteger(thread.observedWindow)||!Number.isSafeInteger(model?.max_context_window)||policy.window>model.max_context_window)return {};
  const budget=savedBudget(policy,model);if(!budget)return {};
  const expected=thread.compensation?.status==='active'&&thread.compensation.targetWindow===budget.usableWindow?thread.compensation.runtimeWindow:budget.usableWindow;
  const matches=thread.observedWindow===expected;
  return {expectedWindow:expected,phase:matches?'confirmed':'mismatch',message:matches?'模型切换后的实际窗口已读回确认。':'模型切换后，实际窗口与当前预算不一致。'};
}
