import os from 'node:os';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

test('a same-version rebuild replaces only its identified stale service',{timeout:15000,skip:process.platform==='win32'},async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-upgrade-'));const file=path.join(root,'code/src/daemon.mjs');fs.mkdirSync(path.dirname(file),{recursive:true});
  process.env.CONTEXT_CONTROL_HOME=root;process.env.CONTEXT_CONTROL_CODEX_HOME=path.join(root,'codex');
  const current=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8')).version;
  fs.writeFileSync(file,`import net from 'node:net';import fs from 'node:fs';import readline from 'node:readline';import path from 'node:path';
const root=process.env.CONTEXT_CONTROL_HOME;
net.createServer(socket=>readline.createInterface({input:socket}).on('line',line=>{const m=JSON.parse(line);socket.write(JSON.stringify({replyTo:m.id,result:{ok:true,version:'${current}',buildId:'stale-fixture'}})+'\\n');})).listen(path.join(root,'ipc.sock'),()=>{fs.writeFileSync(path.join(root,'connection.json'),JSON.stringify({pid:process.pid}));console.log('ready');});
`);
  const old=spawn(process.execPath,[file],{env:process.env,stdio:['ignore','pipe','pipe']});let servicePID;
  try{
    await once(old.stdout,'data');
    const {ensureDaemon}=await import('../src/service.mjs');const {request}=await import('../src/ipc.mjs');
    fs.writeFileSync(path.join(root,'connection.json'),JSON.stringify({pid:process.pid}));
    await assert.rejects(ensureDaemon(),/进程路径无法确认/);
    assert.equal((await request('ping')).buildId,'stale-fixture');
    fs.writeFileSync(path.join(root,'connection.json'),JSON.stringify({pid:old.pid}));
    assert.equal((await ensureDaemon()).version,current);
    servicePID=JSON.parse(fs.readFileSync(path.join(root,'connection.json'),'utf8')).pid;
    assert.notEqual(servicePID,old.pid);assert.equal((await request('ping')).version,current);assert.notEqual((await request('ping')).buildId,'stale-fixture');
    assert.equal((await ensureDaemon()).version,current);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root,'connection.json'),'utf8')).pid,servicePID);
  }finally{
    old.kill();if(servicePID)try{process.kill(servicePID,'SIGTERM');}catch{}
    await new Promise(r=>setTimeout(r,100));fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
});
