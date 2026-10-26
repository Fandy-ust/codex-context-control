import test from 'node:test';
import assert from 'node:assert/strict';
import {accountQuotaViews} from '../src/core/account-quota-link.mjs';
import {sidebarAccounts} from '../desktop/renderer/sidebar-quota.mjs';
import {accountSwitchView,switchSavedAccount} from '../desktop/renderer/account-switch.mjs';

const t=(zh,en,...args)=>en.replace(/\{(\d+)\}/g,(_,i)=>args[i]);
const e=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const bucket={id:'codex',name:'Codex',creditBalance:'43',primary:{remainingPercent:0,windowDurationMins:300,resetsAt:2000000000},secondary:{remainingPercent:69,windowDurationMins:10080,resetsAt:2000100000}};
const profiles=[{id:'first',email:'first@example.test',workspace:'work',name:'Work'},{id:'second',email:'second@example.test',workspace:'home',name:'Personal'}];
const account=(id,current=false)=>({scope:id,email:id+'@example.test',label:'Renamed '+id,current,buckets:[bucket],updatedAt:1000});

test('links renamed observations by stable email and preserves cached quota and credits',()=>{
  const original={profiles},quota={accounts:[account('first',true),account('second')]};const result=accountQuotaViews(original,quota);
  assert.equal(result.quota.accounts[1].loginId,'second');assert.equal(result.login.profiles[1].quota.buckets[0].creditBalance,'43');
  assert.equal(result.login.profiles[1].quota.buckets[0].secondary.resetsAt,2000100000);assert.equal(original.profiles[0].quota,undefined);assert.equal(quota.accounts[0].loginId,undefined);
});
test('does not attach a sign-in or quota to an ambiguous email or a mismatched workspace',()=>{
  const login={profiles:[...profiles,{id:'other',email:profiles[0].email,workspace:'other',name:'Other workspace'}]};
  assert.equal(accountQuotaViews(login,{accounts:[account('first')]}).quota.accounts[0].loginId,null);
  assert.equal(accountQuotaViews(login,{accounts:[{...account('first'),workspace:'work'}]}).quota.accounts[0].loginId,'first');
  assert.equal(accountQuotaViews(login,{accounts:[{...account('first'),workspace:'unknown'}]}).quota.accounts[0].loginId,null);
});
test('cards reuse the compact quota and Credits UI and sidebars expose only linked inactive quick switches',()=>{
  const {login,quota}=accountQuotaViews({profiles},{accounts:[account('first',true),account('second')]});
  const cards=accountSwitchView(login,{e,t});assert.equal((cards.match(/data-login-quota=/g)||[]).length,2);assert.equal((cards.match(/data-quota-reset=/g)||[]).length,4);assert.match(cards,/>43<\/strong>/);
  assert.doesNotMatch(cards,/data-action="quota-details"/,'read-only account summaries must not open the current account details');
  const sidebar=sidebarAccounts({quota,t,escape:e});assert.equal((sidebar.match(/class="sidebar-account-switch"/g)||[]).length,1);assert.match(sidebar,/data-id="second"/);assert.doesNotMatch(sidebar,/data-id="first"/);
  quota.accountSwitchBusy=true;assert.match(sidebarAccounts({quota,t,escape:e}),/data-id="second"[^>]*disabled/);
});
test('one click switches directly and requests automatic process shutdown',async()=>{
  const calls=[],api={invoke:async(action,params)=>{calls.push({action,params});return {ok:true};}};
  assert.deepEqual(await switchSavedAccount(api,{id:'second',name:'Personal'}),{ok:true});
  assert.deepEqual(calls,[{action:'account-switch',params:{action:'switch',id:'second',confirmed:true,force:true}}]);
});

test('one click switch surfaces a failed shutdown without retrying',async()=>{
  let calls=0;const api={invoke:async()=>{calls++;throw Error('stop denied');}};
  await assert.rejects(switchSavedAccount(api,{id:'second'}),/stop denied/);
  assert.equal(calls,1);
});
