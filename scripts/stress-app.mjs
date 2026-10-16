// Offline stress runner: isolated state, mock runtime peers, synthetic histories.
// No account credentials or model inference are used.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';import {performance,monitorEventLoopDelay} from 'node:perf_hooks';import {DatabaseSync} from 'node:sqlite';import {fileURLToPath} from 'node:url';
const large=process.argv.includes('--large');
const repo=fileURLToPath(new URL('../',import.meta.url)),temp=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-stress-')),home=path.join(temp,'home'),control=path.join(temp,'control');fs.mkdirSync(home);fs.mkdirSync(control);
process.env.CONTEXT_CONTROL_HOME=control;process.env.CONTEXT_CONTROL_CODEX_HOME=home;
const fake=path.join(temp,'runtime');fs.writeFileSync(fake,'#!/bin/sh\nprintf "codex-cli 0.160.0\\n"\n',{mode:0o700});process.env.CONTEXT_CONTROL_REAL_CODEX=fake;
fs.copyFileSync(path.join(repo,'test/fixtures/models.json'),path.join(home,'models_cache.json'));fs.writeFileSync(path.join(control,'context-extension.json'),JSON.stringify({enabled:true}));
const {transitionExtensionBudgets}=await import('../src/extension-transition.mjs');const {ceilingModel}=await import('../src/context-ceiling.mjs');const {policyForNewChat}=await import('../src/new-chat-defaults.mjs');
const {startDaemon}=await import('../src/daemon.mjs');const {request,connect}=await import('../src/ipc.mjs');const {createContextStatisticsService}=await import('../src/context-statistics-service.mjs');const {analyzeContext}=await import('../src/context-statistics.mjs');
const report={startedAt:new Date().toISOString(),remoteModelRequests:0,isolated:true,phases:[]},start=performance.now(),cpu=process.cpuUsage();let peak=process.memoryUsage().rss;
const monitor=setInterval(()=>peak=Math.max(peak,process.memoryUsage().rss),20);monitor.unref();const lag=monitorEventLoopDelay({resolution:10});lag.enable();
let daemon,stats;const peers=[];const sleep=ms=>new Promise(r=>setTimeout(r,ms));const p95=a=>[...a].sort((x,y)=>x-y)[Math.floor((a.length-1)*.95)]??0;
async function phase(name,fn){const begin=performance.now();const data=await fn();const result={name,ms:Math.round(performance.now()-begin),...data};report.phases.push(result);console.log(JSON.stringify(result));}
try{
 await phase('budget-mode-fuzz',async()=>{
  let seed=137;const rand=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
  for(let i=0;i<10000;i++){
   const native={max_context_window:[400000,872000,1000000][rand(3)],effective_context_window_percent:[90,95,100][rand(3)],context_window:272000},extended=ceilingModel(native);
   const w=(34+rand(887))*1000,c=Math.min(w-16000,Math.max(17000,Math.floor(w*.8/1000)*1000)),defaults={usableWindow:w,compact:c,revision:1};
   const original=policyForNewChat(defaults);let state={policies:{chat:original},defaults};state=transitionExtensionBudgets(state,false,()=>native,native);
   assert.ok(state.policies.chat.window<=native.max_context_window);assert.ok(state.policies.chat.compact<=Math.floor(state.policies.chat.window*90/100));
   if(i%10===0){state.policies.chat=policyForNewChat({usableWindow:200000,compact:160000,revision:2},native);delete state.restore.policies.chat;}
   state=transitionExtensionBudgets(state,true,()=>extended,extended);if(i%10===0)assert.equal(Math.floor(state.policies.chat.window*.9),200000);else{assert.equal(state.policies.chat.window,original.window);assert.equal(state.policies.chat.compact,original.compact);}assert.equal(state.defaults.usableWindow,w);
   if(i%200===0)await sleep(0);
  }return {roundTrips:10000,transitions:20000,manualEditCases:1000};
 });
 daemon=await startDaemon();const connection=JSON.parse(fs.readFileSync(path.join(control,'connection.json')));const base=`http://127.0.0.1:${connection.port}`,headers={authorization:`Bearer ${connection.token}`};
 const post=async(route,body,h=headers)=>{const r=await fetch(base+route,{method:'POST',headers:h,body:JSON.stringify(body)});return {status:r.status,data:await r.json().catch(()=>null)};};
 const ids=Array.from({length:24},()=>crypto.randomUUID());
 async function attach(on){for(let i=0;i<4;i++){const p=await connect(async()=>{await sleep(1);return {queued:true};});peers.push(p);await p.call('registerBridge',{pid:process.pid,contextCeiling:on?1:null,contextCatalogRevision:on?2:null,newChatDefaultsVersion:2});for(let j=i;j<ids.length;j+=4)await p.call('updateThread',{id:ids[j],name:'Synthetic chat '+j,model:'context-fixture',status:'idle',lastUsage:{totalTokens:1000},freshUsage:true,observedWindow:on?920000:828400});}}
 async function detach(){for(const p of peers.splice(0))p.close();for(let n=0;n<100;n++){if((await request('state')).bridgeCount===0)return;await sleep(5);}throw Error('Disconnect did not settle');}
 await attach(true);
 await phase('observation-persistence',async()=>{
  daemon.store.flush();const before=daemon.store.diagnostics().writes;
  for(let n=0;n<1000;n++)await peers[n%4].call('updateThread',{id:ids[n%24],model:'context-fixture',status:'idle',lastUsage:{totalTokens:n},freshUsage:true,observedWindow:920000});
  daemon.store.flush();const writes=daemon.store.diagnostics().writes-before;assert.ok(writes<100);const saved=JSON.parse(fs.readFileSync(path.join(control,'state.json')));assert.equal(saved.threads[ids[999%24]].lastUsage.totalTokens,999);return {observations:1000,persistedWrites:writes};
 });
 await phase('concurrent-control-requests',async()=>{
  const latency=[];let total=0;for(let batch=0;batch<50;batch++)await Promise.all(ids.map(async(id,i)=>{const t=performance.now(),w=200000+((batch+i)%73)*10000;const r=await post('/policy',{id,policy:{window:Math.ceil(w/.9),compact:Math.floor(w*.8),reserve:16000},apply:true});assert.equal(r.status,200);latency.push(performance.now()-t);total++;}));
  const s=await request('state');assert.equal(s.threads.length,24);for(const t of s.threads)assert.equal(t.policy.revision,50);
  for(let batch=0;batch<50;batch++){const revision=(await request('state')).newChatDefaults.revision;const results=await Promise.all([post('/new-chat-defaults',{usableWindow:400000,compact:360000,expectedRevision:revision}),post('/new-chat-defaults',{usableWindow:500000,compact:450000,expectedRevision:revision})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,400]);}
  return {policyWrites:total,concurrency:24,p95Ms:Number(p95(latency).toFixed(2)),maxMs:Number(Math.max(...latency).toFixed(2)),competingDefaultWrites:100};
 });
 await phase('toggle-reconnect-and-recovery',async()=>{
  await request('setNewChatDefaults',{usableWindow:920000,compact:904000});
  const before=(await request('state')).threads.map(t=>[t.id,t.policy.window,t.policy.compact]);
  for(let i=0;i<25;i++){
   assert.equal((await post('/context-extension',{enabled:false})).status,200);assert.equal((await post('/context-extension',{enabled:false})).status,200);let s=await request('state');assert.equal(s.contextExtension.effective,false);assert.equal(s.contextExtension.pending,true);assert.ok(s.threads.every(t=>t.modelMetadata.max_context_window===872000));
   await detach();assert.equal((await request('state')).contextExtension.pending,false);await attach(false);assert.equal((await request('state')).contextExtension.enabled,false);
   assert.equal((await post('/context-extension',{enabled:true})).status,200);await detach();s=await request('state');assert.equal(s.contextExtension.effective,false);assert.match(s.contextExtension.message,/等待/);await attach(true);assert.equal((await request('state')).contextExtension.effective,true);
  }
  const after=(await request('state')).threads;for(const [id,w,c] of before){const p=after.find(t=>t.id===id).policy;assert.equal(p.window,w);assert.equal(p.compact,c);}
  assert.equal((await request('state')).newChatDefaults.usableWindow,920000);assert.equal(JSON.parse(fs.readFileSync(path.join(control,'state.json'))).extensionRestore,undefined);
  return {switches:50,idempotentDisableCalls:25,bridgeReconnects:200,chatReattachments:1200,restoredBudgets:24};
 });
 await phase('invalid-input-and-authentication',async()=>{
  let rejected=0;for(let round=0;round<50;round++){
   for(const bad of [null,{}, {usableWindow:-1,compact:10},{usableWindow:10000000,compact:900000},{usableWindow:400001,compact:360000}]){assert.equal((await post('/new-chat-defaults',bad)).status,400);rejected++;}
   for(const id of ['__proto__','constructor','prototype']){assert.equal((await post('/policy',{id,policy:{window:400000,compact:300000},apply:false})).status,400);rejected++;}
   assert.equal((await post('/context-extension',{enabled:'yes'})).status,400);assert.equal((await post('/runtime-fix',{enabled:'yes'})).status,400);rejected+=2;
   assert.equal((await post('/context-extension',{enabled:false},{})).status,403);assert.equal((await post('/context-extension',{enabled:false},{...headers,origin:'https://example.test'})).status,403);rejected+=2;
  }
  assert.equal((await request('ping')).ok,true);return {rejectedRequests:rejected,recovered:true};
 });
 await detach();await new Promise(r=>daemon.ipcServer.close(r));daemon.web.closeAllConnections();await new Promise(r=>daemon.web.close(r));
 const historyHome=path.join(temp,'history');fs.mkdirSync(historyHome);const db=new DatabaseSync(path.join(historyHome,'state_5.sqlite'));db.exec('CREATE TABLE threads(id TEXT,rollout_path TEXT)');
 const historyIds=Array.from({length:12},()=>crypto.randomUUID()),files=[];let bytes=0;
 for(const [i,id] of historyIds.entries()){
  const events=[{type:'session_meta',payload:{}},{type:'turn_context',payload:{model:'gpt-6-sol',service_tier:'default'}}];
  for(let n=0;n<150;n++){events.push({type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:`Synthetic ${i} ${n} `+'payload '.repeat(large?1000:100)}]}},{type:'response_item',payload:{type:'function_call_output',call_id:`call-${n}`,output:'synthetic tool '.repeat(large?800:80)}},{type:'response_item',payload:{type:'message',role:'assistant',phase:'final',content:[{type:'output_text',text:'Done.'}]}},{type:'token_usage_record',payload:{response_id:`response-${n}`,usage:{input_tokens:large?10000+n*5000:5000+n*100,cached_input_tokens:large?9000+n*4800:4000+n*100,output_tokens:10}}});}
  const file=path.join(historyHome,id+'.jsonl'),body=events.map(e=>JSON.stringify({...e,timestamp:'2026-10-16T00:00:00Z'})).join('\n')+'\n';fs.writeFileSync(file,body);bytes+=Buffer.byteLength(body);files.push(file);db.prepare('INSERT INTO threads VALUES(?,?)').run(id,file);
 }db.close();stats=createContextStatisticsService(historyHome,{cacheMs:0,idleMs:100});
 await phase('statistics-load-cache-and-failure-recovery',async()=>{
  const same=await Promise.all(Array.from({length:100},()=>stats(historyIds[0])));assert.ok(same.every(s=>s.generatedAt===same[0].generatedAt));assert.equal(stats.diagnostics().workerStarts,1);
  const burst=await Promise.allSettled(historyIds.map(id=>stats(id)));assert.equal(burst.filter(r=>r.status==='fulfilled').length,8);assert.equal(burst.filter(r=>r.status==='rejected').length,4);assert.ok(stats.diagnostics().workers<=2);
  const warm=[];for(let n=0;n<200;n++){const t=performance.now();await stats(historyIds[0]);warm.push(performance.now()-t);}
  const unchanged=stats.diagnostics().last;assert.equal(unchanged.resultCacheHit,true);
  const append={type:'response_item',timestamp:'2026-10-16T00:00:01Z',payload:{type:'message',role:'user',content:[{type:'input_text',text:'A new appended message.'}]}};fs.appendFileSync(files[0],JSON.stringify(append)+'\n');const updated=await stats(historyIds[0]);const {generatedAt,...a}=updated,{generatedAt:_,...b}=analyzeContext(historyHome,historyIds[0]);assert.deepEqual(a,b);
  const kept=fs.readFileSync(files[1]);fs.writeFileSync(files[1],'invalid\n');await assert.rejects(stats(historyIds[1],true));fs.writeFileSync(files[1],kept);assert.equal((await stats(historyIds[1],true)).threadId,historyIds[1]);
  await sleep(300);assert.equal(stats.diagnostics().workers,0);
  return {histories:12,events:7224,bytes,sameChatBurst:100,distinctChatBurst:12,backpressureRejections:4,warmReads:200,warmP95Ms:Number(p95(warm).toFixed(2)),incrementalMatchesCold:true,corruptionRecovered:true,idleWorkersReleased:true};
 });
 report.status='passed';
}catch(error){report.status='failed';report.error=error.message;throw error;}
finally{
 stats?.close();for(const p of peers)p.close();if(daemon){daemon.web.closeAllConnections();daemon.web.close();daemon.ipcServer.close();}
 clearInterval(monitor);lag.disable();peak=Math.max(peak,process.memoryUsage().rss);const usage=process.cpuUsage(cpu);Object.assign(report,{finishedAt:new Date().toISOString(),elapsedMs:Math.round(performance.now()-start),cpuMs:Math.round((usage.user+usage.system)/1000),observedPeakRssMiB:Number((peak/1024/1024).toFixed(1)),eventLoopP99Ms:Number((lag.percentile(99)/1e6).toFixed(2))});
 fs.mkdirSync(path.join(repo,'build'),{recursive:true});fs.writeFileSync(path.join(repo,large?'build/app-stress-report-large.json':'build/app-stress-report.json'),JSON.stringify(report,null,2)+'\n');fs.rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 console.log(JSON.stringify({status:report.status,elapsedMs:report.elapsedMs,observedPeakRssMiB:report.observedPeakRssMiB}));
}
