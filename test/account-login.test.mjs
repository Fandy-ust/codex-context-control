import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {nativeAccountSession} from '../src/account-login.mjs';

test('native login uses isolated official RPC and completes without sending a model request',async()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'account-login-rpc-')),fixture=path.join(home,'native.cjs');
  fs.writeFileSync(fixture,`
const fs=require('node:fs'),path=require('node:path');
require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);fs.appendFileSync(path.join(process.env.CODEX_HOME,'methods.jsonl'),JSON.stringify({method:m.method,home:process.env.CODEX_HOME})+'\\n');
 const send=value=>process.stdout.write(JSON.stringify(value)+'\\n');
 if(m.method==='account/login/start'){
  send({id:m.id,result:{type:'chatgpt',loginId:'fixture-login',authUrl:'https://auth.openai.com/authorize?redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback'}});
  setTimeout(()=>send({method:'account/login/completed',params:{loginId:'fixture-login',success:true}}),20);
 }else if(m.id)send({id:m.id,result:m.method==='account/read'?{account:{type:'chatgpt',email:'fixture@example.test'}}:{}});
});`);
  const session=nativeAccountSession({home,binary:process.execPath,launcherArgs:[fixture],timeout:1000});
  try{let opened;const account=await session.login(url=>{opened=url;});assert.match(opened,/auth.openai.com/);assert.equal(account.email,'fixture@example.test');
    assert.deepEqual(fs.readFileSync(path.join(home,'methods.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line).method),['initialize','initialized','account/login/start','account/read']);
  }finally{await session.close();fs.rmSync(home,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

test('native launch failure and cancellation reject promptly and close the child',async()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'account-login-fail-'));
  try{const missing=nativeAccountSession({home,binary:path.join(home,'missing.exe'),timeout:500});await assert.rejects(missing.read(),/关闭/);await missing.close();
    const fixture=path.join(home,'silent.cjs');fs.writeFileSync(fixture,"process.stdin.resume();setInterval(()=>{},1000)");const silent=nativeAccountSession({home,binary:process.execPath,launcherArgs:[fixture],timeout:100});await assert.rejects(silent.read(),/超时/);await silent.close();
  }finally{fs.rmSync(home,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
