import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeQuota} from '../src/account-quota.mjs';
import {quotaLevel,quotaCountdown} from '../src/quota-display.mjs';
import {sidebarCredits,sidebarQuota,quotaOutlinePath} from '../desktop/renderer/sidebar-quota.mjs';
const t=(zh,en,...args)=>en.replace(/\{(\d+)\}/g,(_,i)=>args[i]);
const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const render=response=>sidebarQuota({quota:{buckets:normalizeQuota(response),stale:false},t,escape});

test('credit badge abbreviates large balances, retains exact tooltip and distinguishes zero from unknown',()=>{
 const badge=(credits,stale=false)=>sidebarCredits({quota:{buckets:normalizeQuota({rateLimits:{credits}}),stale},t,escape});
 assert.match(badge({balance:'30240.123456'}),/30\.2K/);assert.match(badge({balance:'30240.123456'}),/30,240\.123456/);
 assert.match(badge({balance:'0'}),/>0<\/strong>/);assert.equal(badge({hasCredits:true}),'');assert.equal(badge({balance:'invalid'}),'');
 assert.match(badge({balance:'1250000'}),/1\.3M/);assert.match(badge({unlimited:true}),/∞/);
 assert.match(badge({balance:'23'},true),/Cached observation/);assert.match(badge({balance:'23'}),/data-action="quota-details"/);
});
test('quota thresholds use strict comparisons, including zero and unknown',()=>{
 for(const [value,level] of [[100,''],[20,''],[19.9,'warning'],[5,'warning'],[4.9,'critical'],[0,'critical'],[null,''],[NaN,'']])assert.equal(quotaLevel(value),level);
});
test('Plus shows both observed cycles with time and countdown; weekly-only accounts do not invent 5 hours',()=>{
 const weekly={usedPercent:96,windowDurationMins:10080,resetsAt:2000000000},short={usedPercent:85,windowDurationMins:300,resetsAt:1999900000};
 const plus=render({rateLimits:{primary:weekly,secondary:short}});
 assert.ok(plus.indexOf('5 hours')<plus.indexOf('Weekly'));assert.match(plus,/warning/);assert.match(plus,/critical/);assert.equal((plus.match(/data-quota-reset=/g)||[]).length,2);assert.match(plus,/Resets:/);assert.match(plus,/>\d+d\d+h</);
 const pro=render({rateLimits:{primary:weekly}});assert.match(pro,/Weekly/);assert.doesNotMatch(pro,/5 hours/);
});
test('missing quota is unavailable; explicit credits-only accounts survive normalization',()=>{
 assert.match(render({}),/Quota unavailable/);assert.doesNotMatch(render({}),/Unlimited/);
 assert.match(render({rateLimits:{credits:{unlimited:true}}}),/Unlimited extra credits/);
 assert.match(render({rateLimits:{credits:{balance:'23'}}}),/Extra credits: 23/);
 assert.match(render({rateLimits:{credits:{hasCredits:true}}}),/Extra credits available/);
 const cached=sidebarQuota({quota:{buckets:normalizeQuota({rateLimits:{primary:{usedPercent:98}}}),stale:false},available:false,t,escape});assert.match(cached,/Cached observation/);assert.match(cached,/critical/);
});
test('countdown crosses days, hours, seconds and expiry without negative values',()=>{
 const now=2000000000000,reset=seconds=>quotaCountdown(now/1000+seconds,t,now);
 assert.equal(reset(90061),'In 1d 1h');assert.equal(reset(3661),'In 1h 1m');assert.equal(reset(61),'In 1m 1s');assert.equal(reset(1),'In 0m 1s');assert.equal(reset(-1),'Waiting for quota refresh');assert.equal(quotaCountdown(null,t,now),'Reset time unavailable');
});

test('quota outline starts at top center and scales its clockwise rounded path',()=>{
 for(const width of [150,180,260]){
  const path=quotaOutlinePath(width,48);assert.ok(path.startsWith(`M ${width/2} 1.5 H ${width-24}`));assert.ok(path.endsWith(`H ${width/2}`));assert.equal((path.match(/ A /g)||[]).length,2);
 }
 const full=render({rateLimits:{primary:{usedPercent:0,windowDurationMins:300,resetsAt:2000000000}}});
 assert.match(full,/stroke-dasharray="100 100"/);assert.doesNotMatch(full,/sidebar-quota-heading|quota-meter|Resets: [^"<]+<\/span>|In \d/);
 const zero=render({rateLimits:{primary:{usedPercent:100,windowDurationMins:300}}});assert.match(zero,/visibility="hidden"/);
 assert.equal(quotaCountdown(2000003661000/1000,t,2000000000000,true),'1h1m');
});
