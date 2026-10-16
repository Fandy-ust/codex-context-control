import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('runtime switch requires authentication, validates booleans and cannot enable an absent package',async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-fix-http-')),control=path.join(temp,'control'),home=path.join(temp,'home');
  fs.mkdirSync(home);process.env.CONTEXT_CONTROL_HOME=control;process.env.CONTEXT_CONTROL_CODEX_HOME=home;
  const {startDaemon}=await import('../src/daemon.mjs');const daemon=await startDaemon();
  try{
    const c=JSON.parse(fs.readFileSync(path.join(control,'connection.json')));
    const url=`http://127.0.0.1:${c.port}/runtime-fix`,headers={authorization:`Bearer ${c.token}`};
    const post=(enabled,h=headers)=>fetch(url,{method:'POST',headers:h,body:JSON.stringify({enabled})});
    assert.equal((await post(true,{})).status,403);
    assert.equal((await post(true,{...headers,origin:'https://example.test'})).status,403);
    assert.equal((await post('true')).status,400);
    assert.equal((await post(true)).status,400);
    assert.equal(fs.existsSync(path.join(control,'runtime-fix.json')),false);
    const off=await post(false);assert.equal(off.status,200);
    const state=await off.json();assert.equal(state.enabled,false);assert.equal(state.available,false);
    assert.equal(JSON.parse(fs.readFileSync(path.join(control,'runtime-fix.json'))).enabled,false);
  }finally{
    daemon.web.closeAllConnections();await new Promise(r=>daemon.web.close(r));await new Promise(r=>daemon.ipcServer.close(r));
    fs.rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
});
