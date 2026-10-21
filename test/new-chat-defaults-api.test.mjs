import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
test('default settings require authentication, persist, reject stale writes and leave existing budgets intact',async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-defaults-')),control=path.join(temp,'control'),home=path.join(temp,'home');fs.mkdirSync(home);fs.mkdirSync(control);fs.copyFileSync(new URL('fixtures/models.json',import.meta.url),path.join(home,'models_cache.json'));
 const old={window:444445,compact:350000,revision:8,enabled:true};fs.writeFileSync(path.join(control,'state.json'),JSON.stringify({version:2,threads:{existing:{id:'existing'}},policies:{existing:old}}));
 process.env.CONTEXT_CONTROL_HOME=control;process.env.CONTEXT_CONTROL_CODEX_HOME=home;
 const {startDaemon}=await import('../src/daemon.mjs');const d=await startDaemon();
 try{const c=JSON.parse(fs.readFileSync(path.join(control,'connection.json'))),url=`http://127.0.0.1:${c.port}/new-chat-defaults`,headers={authorization:`Bearer ${c.token}`};
 const post=(body,h=headers)=>fetch(url,{method:'POST',headers:h,body:JSON.stringify(body)});
 assert.equal((await post({usableWindow:400000,compact:360000},{})).status,403);
 assert.equal((await post({usableWindow:400000,compact:360000},{...headers,origin:'https://example.test'})).status,403);
 assert.equal((await post({usableWindow:1000000,compact:800000})).status,400);
 const r=await post({usableWindow:400000,compact:360000,expectedRevision:0});assert.equal(r.status,200);assert.equal((await r.json()).revision,1);
 assert.equal((await post({usableWindow:800000,compact:720000,expectedRevision:0})).status,400);
 const extensionURL=`http://127.0.0.1:${c.port}/context-extension`;
 assert.equal((await fetch(extensionURL,{method:'POST',body:JSON.stringify({enabled:false})})).status,403);
 assert.equal((await fetch(extensionURL,{method:'POST',headers,body:JSON.stringify({enabled:'false'})})).status,400);
 const off=await fetch(extensionURL,{method:'POST',headers,body:JSON.stringify({enabled:false})});assert.equal(off.status,200);const offState=await off.json();assert.equal(offState.effective,false);assert.equal(offState.connectedCount,0);assert.match(offState.message,/已关闭/);
 for(const id of ['__proto__','constructor','prototype']){
  const policyURL=`http://127.0.0.1:${c.port}/policy`,clearURL=`http://127.0.0.1:${c.port}/clear`;
  assert.equal((await fetch(policyURL,{method:'POST',headers,body:JSON.stringify({id,policy:{window:400000,compact:300000},apply:false})})).status,400);
  assert.equal((await fetch(clearURL,{method:'POST',headers,body:JSON.stringify({id})})).status,400);
 }
 const compensationURL=`http://127.0.0.1:${c.port}/compaction-compensation`;
 assert.equal((await fetch(compensationURL,{method:'POST',body:JSON.stringify({enabled:true})})).status,403);
 assert.equal((await fetch(compensationURL,{method:'POST',headers,body:JSON.stringify({enabled:'true'})})).status,400);
 const compensation=await fetch(compensationURL,{method:'POST',headers,body:JSON.stringify({enabled:true})});assert.equal(compensation.status,400);assert.match((await compensation.json()).error,/已停用/);
 const disabled=await fetch(compensationURL,{method:'POST',headers,body:JSON.stringify({enabled:false})});assert.equal(disabled.status,200);assert.equal((await disabled.json()).available,false);
 assert.equal(JSON.parse(fs.readFileSync(path.join(control,'compaction-compensation.json'))).enabled,false);
 const allState=await (await fetch(`http://127.0.0.1:${c.port}/state`,{headers})).json();assert.equal(allState.compactionCompensation.enabled,false);assert.equal(allState.contextExtension.enabled,false);
 const persisted=JSON.parse(fs.readFileSync(path.join(control,'state.json')));assert.equal(persisted.newChatDefaults.usableWindow,400000);assert.deepEqual(persisted.policies.existing,old);
 const {Store}=await import('../src/store.mjs');assert.equal(new Store().data.newChatDefaults.revision,1);
 }finally{d.web.closeAllConnections();await new Promise(r=>d.web.close(r));await new Promise(r=>d.ipcServer.close(r));fs.rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
