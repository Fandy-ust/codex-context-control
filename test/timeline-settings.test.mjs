import test from 'node:test';
import assert from 'node:assert/strict';
import {timelineData} from '../src/timeline-data.mjs';
import {chartSettingsView,chartTooltipView} from '../desktop/renderer/apple-view.mjs';
const row=(index,config)=>({id:'r'+index,index,position:index,config});
const t=(zh,en,...args)=>en.replace(/\{(\d+)\}/g,(_,i)=>args[i]);
const e=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const states=[{model:'gpt-6-sol',effort:'medium',serviceTier:'default'},{model:'gpt-6.1-sol',effort:'xhigh',serviceTier:'priority'},{model:'gpt-6.1-sol',effort:'xhigh',serviceTier:'fast'},{model:'gpt-6.1-sol',effort:'high',serviceTier:'ultrafast'},{model:'gpt-6.1-sol',effort:'high',serviceTier:'standard'}];
test('settings changes belong to the first response using them, with speed aliases normalized',()=>{
 const data=timelineData(states.map((config,i)=>row(i+1,config)));
 assert.deepEqual(data.buckets[0].settingsChanges,[]);
 assert.deepEqual(data.buckets[1].settingsChanges,[{responseIndex:2,field:'model',from:'gpt-6-sol',to:'gpt-6.1-sol'},{responseIndex:2,field:'effort',from:'medium',to:'xhigh'},{responseIndex:2,field:'serviceTier',from:'standard',to:'fast'}]);
 assert.deepEqual(data.buckets[2].settingsChanges,[]);assert.deepEqual(data.buckets[2].speedModes,['fast']);
 assert.equal(data.buckets[3].settingsChanges[1].to,'ultrafast');assert.deepEqual(data.buckets[3].speedModes,['ultrafast']);
 assert.deepEqual(data.buckets[4].settingsChanges,[{responseIndex:5,field:'serviceTier',from:'ultrafast',to:'standard'}]);
});
test('grouping and smoothing preserve all observed transitions; missing fields do not invent changes',()=>{
 const grouped=timelineData(states.map((config,i)=>row(i+1,config)),[],{limit:1,period:40}).buckets[0];
 assert.deepEqual(grouped.settingsChanges.map(x=>x.responseIndex),[2,2,2,4,4,5]);assert.deepEqual(grouped.speedModes,['fast','ultrafast']);
 const missing=timelineData([row(1,states[0]),row(2,{}),row(3,states[1])]);assert.ok(missing.buckets.every(b=>!b.settingsChanges.length));
 const initialFast=timelineData([row(1,states[1])]).buckets[0];assert.deepEqual(initialFast.settingsChanges,[]);assert.deepEqual(initialFast.speedModes,['fast']);
});
test('hover and pinned details show model/effort transitions and both lightning modes safely',()=>{
 const bucket=timelineData(states.map((config,i)=>row(i+1,config)),[],{limit:1}).buckets[0];
 const html=chartTooltipView({bucket,e,t,k:String,amount:String});
 for(const text of ['GPT-6 Sol → GPT-6.1 Sol','Medium → XHigh','⚡ Fast','⚡⚡ Ultrafast','Ultrafast → Standard','#2'])assert.ok(html.includes(text),text);
 const hostile={...bucket,settingsChanges:[{responseIndex:1,field:'model',from:'<script>',to:'"bad"'}]};
 const safe=chartSettingsView({bucket:hostile,e,t});assert.doesNotMatch(safe,/<script>/);assert.match(safe,/&lt;script>/);
 const crowded={...bucket,settingsChanges:Array.from({length:20},(_,i)=>({...bucket.settingsChanges[0],responseIndex:i+1}))};
 assert.match(chartSettingsView({bucket:crowded,e,t,compact:true}),/14 more changes/);
 assert.equal((chartSettingsView({bucket:crowded,e,t}).match(/timeline-setting-change/g)||[]).length,20);
});
