import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {DatabaseSync} from 'node:sqlite';
test('authenticated analytics scans local numeric records and rejects invalid filters without changing budgets',async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'qa-http-')),home=path.join(temp,'codex'),control=path.join(temp,'control');fs.mkdirSync(home);fs.mkdirSync(control);
 process.env.CONTEXT_CONTROL_HOME=control;process.env.CONTEXT_CONTROL_CODEX_HOME=home;
 const now=Date.now(),file=path.join(home,'a.jsonl'),lines=[];
 for(let i=0;i<3;i++){const timestamp=new Date(now-600000+i*120000).toISOString();lines.push({timestamp,type:'event_msg',payload:{type:'token_count',rate_limits:{limit_id:'codex',primary:{used_percent:20+i,window_minutes:10080,resets_at:Math.floor(now/1000)+86400}}}});lines.push({timestamp,type:'token_usage_record',payload:{response_id:'response-'+i,thread_id:'a',usage:{input_tokens:100,output_tokens:20,cached_input_tokens:50}}});}
 fs.writeFileSync(file,lines.map(x=>JSON.stringify(x)).join('\n')+'\n');
 const db=new DatabaseSync(path.join(home,'state_5.sqlite'));db.exec('CREATE TABLE threads (id TEXT,rollout_path TEXT,cwd TEXT)');db.prepare('INSERT INTO threads VALUES (?,?,?)').run('a',file,temp);db.close();
 fs.writeFileSync(path.join(control,'state.json'),JSON.stringify({version:9,threads:{},policies:{preserved:{window:400000,compact:350000}}}));
 fs.writeFileSync(path.join(control,'cloud-sync.json'),JSON.stringify({includeUnassigned:true}));
 const {startDaemon}=await import('../src/daemon.mjs');const d=await startDaemon();
 try {
  const c=JSON.parse(fs.readFileSync(path.join(control,'connection.json'))),url=`http://127.0.0.1:${c.port}/quota/analytics`,headers={authorization:`Bearer ${c.token}`};
  assert.equal((await fetch(url,{method:'POST',body:'{}'})).status,403);
  const syncURL=`http://127.0.0.1:${c.port}/cloud-sync`;
  assert.equal((await fetch(syncURL,{method:'POST',body:'{}'})).status,403);
  const accountURL=`http://127.0.0.1:${c.port}/accounts`;
  assert.equal((await fetch(accountURL,{method:'POST',body:'{}'})).status,403);
  const accountStatus=await fetch(accountURL,{method:'POST',headers,body:'{"action":"status"}'});assert.equal(accountStatus.status,200);assert.deepEqual((await accountStatus.json()).profiles,[]);
  const syncStatus=await fetch(syncURL,{method:'POST',headers,body:'{"action":"status"}'});assert.equal(syncStatus.status,200);assert.equal((await syncStatus.json()).enabled,false);
  assert.equal((await fetch(syncURL,{method:'POST',headers,body:'{"action":"configure","intervalMinutes":1}'})).status,400);
  assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify({days:999})})).status,400);
  assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify({model:42})})).status,400);
  for(const filter of [{costDate:'2026-02-30'},{costDate:'bad'},{costStart:now},{costStart:now,costEnd:now-1},{costStart:now-367*86400000,costEnd:now}])assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify(filter)})).status,400);
  for(const filter of [{outlookStart:now},{outlookStart:now,outlookEnd:now-1},{outlookStart:now-367*86400000,outlookEnd:now}])assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify(filter)})).status,400);
  for(const outlookOverlayCount of [0,13,1.5,'6'])assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify({outlookOverlayCount})})).status,400);
  for(const outlookSmoothing of [1,4,-1,'3'])assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify({outlookSmoothing})})).status,400);
  const range=await fetch(url,{method:'POST',headers,body:JSON.stringify({outlookStart:now-3600000,outlookEnd:now})});assert.equal(range.status,200);assert.equal((await range.json()).dashboard.customRange,true);
  const costResult=await fetch(url,{method:'POST',headers,body:JSON.stringify({costStart:now-650000,costEnd:now-550000})});assert.equal(costResult.status,200);const costReport=await costResult.json();assert.equal(costReport.costCalendar.customRange,true);assert.equal(costReport.costCalendar.daily.reduce((n,p)=>n+p.requests,0),1);
  const filtered=await fetch(url,{method:'POST',headers,body:JSON.stringify({model:'Missing'})});assert.equal(filtered.status,200);const filteredReport=await filtered.json();assert.equal(filteredReport.model,'Missing');assert.equal(filteredReport.quality.requests,0);
  const r=await fetch(url,{method:'POST',headers,body:'{}'});assert.equal(r.status,200);const report=await r.json();assert.equal(report.quality.requests,3);assert.equal(report.charts.length,16);
  const saved=JSON.parse(fs.readFileSync(path.join(control,'state.json')));assert.equal(saved.version,9);assert.equal(saved.policies.preserved.window,400000);
 } finally {d.web.closeAllConnections();await new Promise(r=>d.web.close(r));await new Promise(r=>d.ipcServer.close(r));await new Promise(r=>setTimeout(r,150));fs.rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
