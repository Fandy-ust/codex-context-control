import test from 'node:test';
import assert from 'node:assert/strict';
import {chatView} from '../desktop/renderer/apple-view.mjs';

test('compact button is available only for a connected idle direct chat',()=>{
  const render=chat=>chatView({chat,draft:{},observedTitle:'Window',modelName:'Model',canEdit:true,budgetCard:()=>'',e:v=>String(v??''),t:v=>v,tokens:()=>''});
  const idle={id:'chat',connected:true,status:'idle'};
  const button=chat=>render(chat).match(/<button data-action="compact"[^>]*>/)[0];
  assert.ok(!button(idle).includes('disabled'));
  for(const state of [{connected:false},{status:'active'},{status:'unknown'},{ambiguous:true},{ephemeral:true},{canAcceptDirectInput:false},{phase:'compacting'},{phase:'reloading'},{phase:'extension_pending'}])assert.ok(button({...idle,...state}).includes('disabled'),JSON.stringify(state));
});
