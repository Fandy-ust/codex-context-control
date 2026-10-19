import test from 'node:test';import assert from 'node:assert/strict';
import {runManagerCLI,speedReport} from '../src/manager-cli.mjs';
test('chat CLI sends visible capacity to shared validation and preserves budget revision/reserve',async()=>{
 const calls=[];const client=async(op,p)=>{calls.push({op,p});return op==='state'?{capabilities:{visibleBudget:true},threads:[{id:'chat',policy:{window:421053,compact:360000,reserve:18000,retainedFloor:1000,revision:4},modelMetadata:{effective_context_window_percent:95,max_context_window:872000}}]}:{saved:true};};
 await runManagerCLI(['chat','set','chat','--window','500K','--compact','450K'],{client});assert.equal(calls[1].op,'policy');assert.deepEqual(calls[1].p,{id:'chat',budget:{usableWindow:500000,compact:450000,reserve:18000,retainedFloor:1000,scope:'total'},expectedRevision:4,apply:true});
 calls.length=0;await runManagerCLI(['chat','set','chat','--window','400K','--save-only'],{client});assert.equal(calls[1].p.apply,false);
 calls.length=0;await assert.rejects(runManagerCLI(['chat','set','chat','--window','2M'],{client}));assert.equal(calls.filter(c=>c.op==='policy').length,0);
 calls.length=0;await assert.rejects(runManagerCLI(['chat','speed','chat','--tier','priority'],{client}),e=>e.code==='INVALID_ARGUMENT');assert.equal(calls.length,0);
});
test('speed analysis uses recorded durations, separates configurations and retains missing measurements',()=>{
 const config={model:'model',effort:'high',serviceTier:'default'};
 const r=speedReport('chat',{responses:[{id:'a',config,eventType:'final',outputTokens:100,durationMs:1000,tokensPerSecond:100,timingKind:'observed_generation'},{id:'b',config,eventType:'final',outputTokens:600,durationMs:3000,tokensPerSecond:200,timingKind:'observed_generation'},{id:'missing',config,eventType:'final',outputTokens:100,durationMs:null,tokensPerSecond:null},{id:'compact',config,eventType:'compaction',outputTokens:50,durationMs:1000,tokensPerSecond:50,timingKind:'observed_generation'}]});
 assert.equal(r.groups.length,2);assert.equal(r.groups[0].tokensPerSecond,175);assert.equal(r.groups[0].unavailableSamples,1);assert.equal(r.samples[2].tokensPerSecond,null);assert.equal(r.groups[1].kind,'compaction');assert.equal(speedReport('empty',{responses:[]}).groups.length,0);
});
