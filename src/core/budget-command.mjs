import {calculateBudget} from './budget.mjs';
import {normalizePolicy} from './policy.mjs';
// New clients send user-visible tokens. Only this shared core converts them to
// native raw-window units. Raw policies remain accepted for older clients.
export function normalizeBudgetCommand(command,model){
 if(Object.hasOwn(command,'budget')){
  if(Object.hasOwn(command,'policy'))throw Error('Specify either budget or policy');
  const input=command.budget;
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Invalid visible budget');
  const {window}=calculateBudget({usableWindow:input.usableWindow,compactPercent:1},model);
  return normalizePolicy({...input,window});
 }
 return normalizePolicy(command.policy);
}
export function budgetCommand(draft,rawPolicy,capabilities){
 if(!capabilities?.visibleBudget)return {policy:rawPolicy};
 const {window,...rest}=rawPolicy;
 return {budget:{...rest,usableWindow:draft.window}};
}
