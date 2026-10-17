import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const runtimeFixPin=JSON.parse(fs.readFileSync(new URL('../runtime-patches/manifest.json',import.meta.url)));
const repo=fileURLToPath(new URL('../',import.meta.url));
const pack=process.env.CONTEXT_CONTROL_TEST_FIX_PACKAGE;
const original='/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let n=0;n<150;n++){try{const value=await fn();if(value)return value;}catch{}await sleep(50);}throw Error('Runtime activation timed out');}

test('lightweight wrapper never selects a previously enabled patched runtime',{
  skip:!pack||process.platform!=='darwin'||!fs.existsSync(original),timeout:45000
},async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-fix-live-')),control=path.join(temp,'control'),home=path.join(temp,'codex');
  fs.mkdirSync(home);fs.mkdirSync(control);
  fs.writeFileSync(path.join(home,'config.toml'),'[features]\nplugins=false\n[analytics]\nenabled=false\n[feedback]\nenabled=false\n');
  fs.mkdirSync(path.join(control,'runtimes'),{recursive:true});
  fs.cpSync(pack,path.join(control,'runtimes',runtimeFixPin.id),{recursive:true});
  process.env.CONTEXT_CONTROL_HOME=control;process.env.CONTEXT_CONTROL_CODEX_HOME=home;
  const {validateRuntimePackage}=await import('../src/runtime-fix.mjs');validateRuntimePackage(pack);
  const {installRuntimeHelpers,useDesktopRuntimeLayout}=await import('../src/runtime-helpers.mjs');
  installRuntimeHelpers(path.join(control,'runtimes',runtimeFixPin.id),original,runtimeFixPin.baseVersion);
  useDesktopRuntimeLayout(path.join(control,'runtimes',runtimeFixPin.id));
  const {request}=await import('../src/ipc.mjs');
  const children=[];
  async function start(){
    const child=spawn(process.execPath,[path.join(repo,'src/wrapper.mjs'),'app-server','--listen','stdio://'],{cwd:temp,env:{PATH:process.env.PATH,HOME:os.homedir(),TMPDIR:temp,CODEX_HOME:home,CONTEXT_CONTROL_HOME:control,CONTEXT_CONTROL_CODEX_HOME:home,CONTEXT_CONTROL_REAL_CODEX:original},stdio:['pipe','pipe','pipe']});
    children.push(child);child.stderr.on('data',()=>{});
    const ready=new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('initialize timeout')),10000);
      const lines=readline.createInterface({input:child.stdout});
      lines.on('line',line=>{const m=JSON.parse(line);if(m.id===1){clearTimeout(timer);m.error?reject(Error('initialize error')):resolve(m.result);}});
    });
    child.stdin.write(JSON.stringify({id:1,method:'initialize',params:{clientInfo:{name:'runtime_fix_selection_test',version:'1'},capabilities:{experimentalApi:true}}})+'\n');
    await ready;child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
    await until(async()=>(await request('state')).bridges.some(b=>b.pid===child.pid));return child;
  }
  async function toggle(enabled){
    const connection=JSON.parse(fs.readFileSync(path.join(control,'connection.json')));
    const response=await fetch(`http://127.0.0.1:${connection.port}/runtime-fix`,{method:'POST',headers:{Authorization:`Bearer ${connection.token}`,'Content-Type':'application/json'},body:JSON.stringify({enabled})});
    assert.equal(response.status,200);return response.json();
  }
  try{
    const first=await start();let state=await request('state');
    assert.equal(state.runtimeFix.enabled,false);assert.equal(state.bridges.find(b=>b.pid===first.pid).runtimeFixId,null);
    await assert.rejects(toggle(true));
    fs.writeFileSync(path.join(control,'runtime-fix.json'),JSON.stringify({enabled:true}));
    const second=await start();state=await request('state');
    assert.equal(state.bridges.find(b=>b.pid===second.pid).runtimeFixId,null);
    assert.equal(state.runtimeFix.enabled,false);

  }finally{
    for(const child of children)child.kill('SIGTERM');
    await sleep(250);
    try{const c=JSON.parse(fs.readFileSync(path.join(control,'connection.json')));process.kill(c.pid,'SIGTERM');}catch{}
    await sleep(200);fs.rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
});
