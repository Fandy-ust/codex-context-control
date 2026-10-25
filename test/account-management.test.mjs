import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createQuotaManager} from '../src/account-quota.mjs';
import {createQuotaAnalyticsService} from '../src/quota-analytics-service.mjs';
import {createCloudSync} from '../src/cloud-sync.mjs';
import {QuotaLedger} from '../src/analytics/ledger.mjs';
import {sidebarAccounts} from '../desktop/renderer/sidebar-quota.mjs';

const buckets=(used=12,reset=2000000000)=>[{id:'codex',name:'Codex',primary:{usedPercent:used,remainingPercent:100-used,windowDurationMins:300,resetsAt:reset},creditBalance:'20'}];
const t=(zh,en,...args)=>en.replace(/\{(\d+)\}/g,(_,i)=>args[i]);
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function temporary(t,close=()=>{}){const home=fs.mkdtempSync(path.join(os.tmpdir(),'account-management-'));t.after(async()=>{await close();fs.rmSync(home,{recursive:true,force:true,maxRetries:10,retryDelay:100});});return home;}

test('cached account quota survives switching, failed reads and restart without changing reset timestamps',async t=>{
  const home=temporary(t);let time=100000,account='a',fail=false;
  const manager=createQuotaManager({home,now:()=>time,onObservation:async()=>`account:${account.repeat(32)}`,read:async()=>{if(fail)throw Error('offline');return {account:{email:account+'@example.test'},rateLimits:{primary:{usedPercent:account==='a'?12:30,windowDurationMins:300,resetsAt:2000000000}}};}});
  await manager.refresh();account='b';time+=11000;await manager.refresh();
  const state=manager.state();assert.equal(state.accounts.length,2);assert.equal(state.accounts[0].label,'b@example.test');assert.equal(state.accounts[1].buckets[0].primary.remainingPercent,88);
  time+=11000;fail=true;await manager.refresh();assert.equal(manager.state().accounts[1].buckets[0].primary.resetsAt,2000000000);
  const restored=createQuotaManager({home});assert.equal(restored.state().accounts.length,2);
  restored.removeAccounts(['account:'+'a'.repeat(32)]);assert.equal(createQuotaManager({home}).state().accounts.length,1);
});

test('names persist independently of profile refresh and deleting one account preserves the other',async t=>{
  const home=temporary(t,async()=>{cloud.close();await analytics.close();}),analytics=createQuotaAnalyticsService({home,historyHome:home}),secrets={get:()=>({}),set:()=>{}};
  let cloud=createCloudSync({home,analytics,secrets});
  const at=Date.now();await analytics.record({account:{type:'chatgpt',email:'first@example.test'},buckets:buckets(),at:at-2000});
  await analytics.record({account:{type:'chatgpt',email:'second@example.test'},buckets:buckets(30),at:at-1000});
  let accounts=(await cloud.command({action:'status'})).accounts;const first=accounts.find(a=>!a.current),second=accounts.find(a=>a.current);
  await cloud.command({action:'rename-account',id:first.id,name:' Work '});
  assert.equal((await cloud.command({action:'status'})).accounts.find(a=>a.id===first.id).customName,'Work');
  cloud.close();cloud=createCloudSync({home,analytics,secrets});assert.equal((await cloud.command({action:'status'})).accounts.find(a=>a.id===first.id).customName,'Work');
  await cloud.command({action:'set-account-visibility',id:first.id,visible:false});
  cloud.close();cloud=createCloudSync({home,analytics,secrets});assert.equal((await cloud.command({action:'status'})).accounts.find(a=>a.id===first.id).showQuota,false);
  assert.equal((await analytics.syncProfiles(Buffer.alloc(32))).length,2,'hiding an account preserves its statistics');
  await assert.rejects(cloud.command({action:'rename-account',id:first.id,name:'x'.repeat(41)}),/Invalid/);
  await cloud.command({action:'delete-account',id:first.id});
  accounts=(await cloud.command({action:'status'})).accounts;assert.deepEqual(accounts.map(a=>a.id),[second.id]);
  assert.equal((await analytics.syncProfiles(Buffer.alloc(32))).length,1);
  assert.equal((await analytics.report({days:28})).quality.snapshots>0,true);
});

test('deletion erases all plan scopes and imported statistics and blocks old data after rescan and resync',t=>{
  const home=temporary(t,()=>ledger.close()),now=Date.now(),ledger=new QuotaLedger({file:path.join(home,'ledger.sqlite'),home,now:()=>now});
  const id='a'.repeat(32),group='b'.repeat(32),scope='account:'+'c'.repeat(32),alias='account:'+'d'.repeat(32),other='account:'+'e'.repeat(32);
  ledger.recordLive({scope,accountGroup:group,identity:'encrypted',at:now-10000,buckets:buckets()});
  ledger.recordLive({scope:alias,accountGroup:group,identity:'encrypted',at:now-5000,buckets:buckets(20)});
  ledger.recordLive({scope:other,accountGroup:'f'.repeat(32),identity:'other',at:now-1000,buckets:buckets(50)});
  const event={type:'token_usage_record',timestamp:new Date(now-3000).toISOString(),payload:{response_id:'old',usage:{input_tokens:100,output_tokens:20}}};
  ledger.consume(event,{id:'thread'});
  const data={version:1,requests:[{id:'remote',at:now-4000,input:5,output:2,cached:0}],snapshots:[]};
  ledger.syncImport({account:id,scope,shards:[{id:'remote',data}]});
  const removed=ledger.deleteAccount({id,scopes:[scope]});assert.deepEqual(new Set(removed.scopes),new Set([scope,alias]));
  ledger.consume(event,{id:'thread'});ledger.snapshot({scope,at:now-2000,bucket:'codex',fiveUsed:10,fiveReset:2000000000});
  ledger.syncImport({account:id,scope,shards:[{id:'remote',data}]});
  assert.equal(ledger.localRead().requests.length,0);assert.ok(ledger.localRead().snapshots.every(r=>r.scope===other));
  assert.equal(ledger.db.prepare('SELECT data FROM cloud_shards').all().every(row=>JSON.parse(row.data).requests.length===0),true);
  assert.equal(ledger.syncProfiles().length,1);
});

test('sidebar stacks current first, escapes names and keeps cached resets without stale banners or overlays',()=>{
  const quota={stale:false,buckets:buckets(),accounts:[{scope:'old',label:'<old>',current:false,buckets:buckets(30),updatedAt:1000},{scope:'now',label:'Work',current:true,buckets:buckets(),updatedAt:2000}]};
  const html=sidebarAccounts({quota,t,escape});
  assert.ok(html.indexOf('Work')<html.indexOf('&lt;old&gt;'));assert.equal((html.match(/class="sidebar-footer-row"/g)||[]).length,2);
  assert.equal((html.match(/data-quota-reset="2000000000"/g)||[]).length,2);assert.match(html,/sidebar-account inactive/);assert.doesNotMatch(html,/sidebar-quota-stale|overlay/);
  quota.accounts[1].showQuota=false;const hidden=sidebarAccounts({quota,t,escape});assert.doesNotMatch(hidden,/Work/);assert.match(hidden,/&lt;old&gt;/);
  quota.accounts[0].showQuota=false;assert.equal(sidebarAccounts({quota,t,escape}),'','turning every account off also hides the current-account fallback');
});
