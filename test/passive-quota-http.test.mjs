import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';

test('only the connected source of the displayed quota suppresses the refresh warning',async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'passive-http-')),home=path.join(temp,'codex'),control=path.join(temp,'control');fs.mkdirSync(home);fs.mkdirSync(control);
 process.env.CONTEXT_CONTROL_HOME=control;process.env.CONTEXT_CONTROL_CODEX_HOME=home;process.env.CONTEXT_CONTROL_REAL_CODEX=process.execPath;
 const observation={account:{type:'chatgpt',email:'test@example.test'},observedAt:Date.now()-120000,rateLimitsByLimitId:{codex:{primary:{usedPercent:20,windowDurationMins:300,resetsAt:Math.floor(Date.now()/1000)+3600}}}};
 fs.writeFileSync(path.join(control,'passive-quota.json'),JSON.stringify(observation));
 const {startDaemon}=await import('../src/daemon.mjs'),d=await startDaemon();
 const {connect,request}=await import('../src/ipc.mjs');let source,other;
 try{
  const c=JSON.parse(fs.readFileSync(path.join(control,'connection.json'))),headers={authorization:`Bearer ${c.token}`};
  const response=await fetch(`http://127.0.0.1:${c.port}/quota`,{method:'POST',headers,body:'{}'});assert.equal(response.status,200);
  assert.equal((await response.json()).displayStale,true,'persisted cache is not a live synchronization');
  source=await connect();await assert.rejects(source.call('observeQuota',observation),/未注册/);
  await source.call('registerBridge',{pid:process.pid});other=await connect();await other.call('registerBridge',{pid:process.pid});
  assert.equal((await request('state')).quota.displayStale,true,'a connection without a matching observation is insufficient');
  await source.call('observeQuota',{...observation,account:null});assert.equal((await request('state')).quota.displayStale,true,'rejected snapshots cannot confirm synchronization');
  await source.call('observeQuota',observation);
  let state=await request('state');assert.equal(state.quota.updatedAt,observation.observedAt);assert.equal(state.quota.stale,true);assert.equal(state.quota.displayStale,false);
  const closed=once(source.socket,'close');source.socket.destroy();await closed;
  for(let i=0;i<20;i++){state=await request('state');if(state.bridgeCount===1)break;await new Promise(r=>setTimeout(r,10));}
  assert.equal(state.bridgeCount,1);assert.equal(state.quota.displayStale,true,'an unrelated remaining bridge cannot hide a source disconnect');
  await other.call('observeQuota',observation);assert.equal((await request('state')).quota.displayStale,false,'reconnected sources may replay their latest snapshot');
  await other.call('observeQuota',{invalidated:true});state=await request('state');assert.equal(state.quota.displayStale,true);assert.deepEqual(state.quota.buckets,[]);
 }finally{
  for(const peer of [source,other])if(peer&&!peer.socket.destroyed){const closed=once(peer.socket,'close');peer.socket.destroy();await closed;}
  d.web.closeAllConnections();await new Promise(r=>d.web.close(r));await new Promise(r=>d.ipcServer.close(r));
  fs.rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 }
});
