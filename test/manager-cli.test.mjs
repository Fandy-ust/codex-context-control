import test from 'node:test';import assert from 'node:assert/strict';
import {runManagerCLI,speedReport} from '../src/manager-cli.mjs';
test('chat CLI sends visible capacity to shared validation and preserves budget revision/reserve',async()=>{
 const calls=[];const client=async(op,p)=>{calls.push({op,p});return op==='chat'?{id:'chat',policy:{window:421053,compact:360000,reserve:18000,retainedFloor:1000,revision:4},modelMetadata:{effective_context_window_percent:95,max_context_window:872000}}:{saved:true};};
 await runManagerCLI(['chat','set','chat','--window','500K','--compact','450K'],{client});assert.equal(calls[1].op,'policy');assert.deepEqual(calls[1].p,{id:'chat',budget:{usableWindow:500000,compact:450000,reserve:18000,retainedFloor:1000,scope:'total'},expectedRevision:4,apply:true,track:true,requestId:calls[1].p.requestId});assert.match(calls[1].p.requestId,/^[a-f0-9-]{36}$/);
 calls.length=0;await runManagerCLI(['chat','set','chat','--window','400K','--save-only'],{client});assert.equal(calls[1].p.apply,false);
 calls.length=0;await assert.rejects(runManagerCLI(['chat','set','chat','--window','2M'],{client}));assert.equal(calls.filter(c=>c.op==='policy').length,0);
 calls.length=0;await assert.rejects(runManagerCLI(['chat','speed','chat','--tier','priority'],{client}),e=>e.code==='INVALID_ARGUMENT');assert.equal(calls.length,0);
});
test('speed analysis uses recorded durations, separates configurations and retains missing measurements',()=>{
 const config={model:'model',effort:'high',serviceTier:'default'};
 const r=speedReport('chat',{responses:[{id:'a',config,eventType:'final',outputTokens:100,durationMs:1000,tokensPerSecond:100,timingKind:'observed_generation'},{id:'b',config,eventType:'final',outputTokens:600,durationMs:3000,tokensPerSecond:200,timingKind:'observed_generation'},{id:'missing',config,eventType:'final',outputTokens:100,durationMs:null,tokensPerSecond:null},{id:'compact',config,eventType:'compaction',outputTokens:50,durationMs:1000,tokensPerSecond:50,timingKind:'observed_generation'}]});
 assert.equal(r.groups.length,2);assert.equal(r.groups[0].tokensPerSecond,175);assert.equal(r.groups[0].unavailableSamples,1);assert.equal(r.samples[2].tokensPerSecond,null);assert.equal(r.groups[1].kind,'compaction');assert.equal(speedReport('empty',{responses:[]}).groups.length,0);
});
test('schedule CLI preserves checkpoint text and stable identity without shell expansion',async()=>{
 const calls=[],env={CODEX_THREAD_ID:'11111111-1111-1111-1111-111111111111'},prompt='Continue with literal $(text) and `quotes`.\nCheck existing progress first.',client=async(op,p)=>{calls.push({op,p});return {};};
 await runManagerCLI(['chat','schedule','current','--prompt-file','checkpoint.txt','--request-id','handoff-1','--after-operation','budget-1','--revision','4'],{env,client,readFile:async()=>prompt});
 assert.deepEqual(calls[0],{op:'context-schedule',p:{id:env.CODEX_THREAD_ID,action:'schedule',prompt,requestId:'handoff-1',afterOperation:'budget-1',expectedRevision:4}});
 calls.length=0;await assert.rejects(runManagerCLI(['chat','schedule','current','--prompt-file','checkpoint.txt'],{env,client}),e=>e.code==='INVALID_ARGUMENT');assert.equal(calls.length,0);
});
