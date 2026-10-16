// Offline reproduction against the installed Codex binary. No credentials,
// real conversations, or remote model requests are used. Synthetic opaque
// reasoning is deliberately accepted by a loopback server only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import readline from 'node:readline';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const repo=fileURLToPath(new URL('../',import.meta.url));
const binary=process.env.CONTEXT_CONTROL_TEST_CODEX||'/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex';
const expectedFixed=process.env.CONTEXT_CONTROL_EXPECT_FIXED==='1';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(predicate){for(let n=0;n<300;n++){if(predicate())return;await delay(50);}throw Error('Probe timed out');}

async function runCase(headerIncluded,threshold=80000){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-accounting-'));
  const home=path.join(temp,'home');fs.mkdirSync(home);
  let child,sequence=0,requestCount=0,compactionStarts=0,stderr='';
  const pending=new Map(),completed=new Set(),requests=[],notifications=[],errors=[];
  const server=http.createServer(async(req,res)=>{
    let body='';for await(const bytes of req)body+=bytes;
    const request=JSON.parse(body),n=requestCount++;
    const isCompaction=(request.input??[]).some(x=>x.type==='compaction_trigger');
    requests.push({context:request.reasoning?.context??null,reasoningItems:(request.input??[]).filter(x=>x.type==='reasoning').length,isCompaction});
    const reasoning={id:`rs_${n}`,type:'reasoning',summary:[],encrypted_content:'A'.repeat(16000)};
    const message={id:`msg_${n}`,type:'message',role:'assistant',status:'completed',phase:'final',content:[{type:'output_text',text:'OK',annotations:[]}]};
    const output=isCompaction?[{id:`cmp_${n}`,type:'context_compaction',encrypted_content:'B'.repeat(1000)}]:[reasoning,message];
    const usage={input_tokens:10000,input_tokens_details:{cached_tokens:0},output_tokens:10,output_tokens_details:{reasoning_tokens:8},total_tokens:10010};
    const events=[{type:'response.created',response:{id:`resp_${n}`,object:'response',status:'in_progress',output:[]}},
      ...output.flatMap((item,i)=>[{type:'response.output_item.added',output_index:i,item},{type:'response.output_item.done',output_index:i,item}]),
      {type:'response.completed',response:{id:`resp_${n}`,object:'response',status:'completed',reasoning:{context:'all_turns'},output,usage}}];
    res.writeHead(200,{'Content-Type':'text/event-stream',...(headerIncluded?{'x-reasoning-included':'true'}:{})});
    res.end(events.map(e=>`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''));
  });
  try{
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    const catalog=path.join(repo,'test/fixtures/models.json');
    fs.writeFileSync(path.join(home,'config.toml'),`model="context-fixture"\nmodel_provider="fixture"\nmodel_catalog_json=${JSON.stringify(catalog)}\nmodel_context_window=100000\nmodel_auto_compact_token_limit=${threshold}\nmodel_auto_compact_token_limit_scope="total"\n[analytics]\nenabled=false\n[feedback]\nenabled=false\n[model_providers.fixture]\nname="Local accounting probe"\nbase_url="http://127.0.0.1:${server.address().port}/v1"\nwire_api="responses"\nrequires_openai_auth=false\nsupports_websockets=false\n`);
    child=spawn(binary,['app-server','--listen','stdio://'],{cwd:temp,env:{PATH:process.env.PATH,HOME:os.homedir(),TMPDIR:temp,CODEX_HOME:home,RUST_LOG:'codex_core::session::turn=trace'},stdio:['pipe','pipe','pipe']});
    child.stderr.on('data',d=>{stderr+=d.toString();});
    readline.createInterface({input:child.stdout}).on('line',line=>{
      let m;try{m=JSON.parse(line);}catch{return;}
      if(m.id!=null&&!m.method&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(`RPC ${m.error.code}`)):p.resolve(m.result);return;}
      if(m.method==='turn/completed')completed.add(m.params.turn.id);
      if(m.method==='item/started'&&String(m.params.item?.type).toLowerCase()==='contextcompaction')compactionStarts++;
      if(m.method==='thread/tokenUsage/updated')notifications.push(m.params.tokenUsage.last.totalTokens);
      if(m.method==='error')errors.push(m.params?.error?.message??'runtime error');
      if(m.method&&m.id!=null)child.stdin.write(JSON.stringify({id:m.id,error:{code:-32601,message:'No tool execution in probe'}})+'\n');
    });
    const call=(method,params)=>new Promise((resolve,reject)=>{
      const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error(`RPC timeout: ${method}`));},15000);
      pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,method,params})+'\n');
    });
    await call('initialize',{clientInfo:{name:'compaction_accounting_probe',version:'1'},capabilities:{experimentalApi:true}});
    child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
    const started=await call('thread/start',{model:'context-fixture',cwd:temp,ephemeral:true,approvalPolicy:'never',sandbox:'read-only',baseInstructions:'Reply OK. Never call tools.',developerInstructions:'Local synthetic accounting test.'});
    const turnCount=expectedFixed?3:2;
    for(let n=0;n<turnCount;n++){
      const t=await call('turn/start',{threadId:started.thread.id,input:[{type:'text',text:`Synthetic user turn ${n}.`}],effort:'low'});
      await until(()=>completed.has(t.turn.id));
    }
    await until(()=>stderr.includes('post sampling token usage'));
    const clean=stderr.replace(/\x1b\[[0-9;]*m/g,'');
    const counts=[...clean.matchAll(/post sampling token usage[^\n]*?total_usage_tokens=(\d+)/g)].map(m=>Number(m[1]));
    assert.deepEqual(errors,[]);
    const thresholdReached=[...clean.matchAll(/post sampling token usage[^\n]*? token_limit_reached=(true|false)/g)].map(m=>m[1]==='true');
    assert.equal(compactionStarts,0); // Both responses finish the turn; no follow-up sampling is requested.
    assert.equal(requests.length,turnCount);
    assert.ok(requests.every(r=>r.context==='all_turns'));
    assert.equal(requests[0].reasoningItems,0);assert.equal(requests[1].reasoningItems,1);
    assert.deepEqual(counts,expectedFixed?[10010,10010,10010]:[10010,headerIncluded?10010:12848]);
    assert.deepEqual(thresholdReached,expectedFixed?[false,false,false]:[false,threshold===11000&&!headerIncluded]);
    assert.ok(notifications.length>=2);assert.ok(notifications.every(n=>n===10010));
    return {headerIncluded,threshold,requests,serverUsage:{input:10000,output:10,total:10010},uiNotifications:notifications,localCompactionCounts:counts,thresholdReached,syntheticOldReasoningEstimate:2838};
  }finally{
    if(child){child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),delay(1000)]);if(child.exitCode==null)child.kill('SIGKILL');}
    for(const p of pending.values())clearTimeout(p.timer);
    server.closeAllConnections();await new Promise(r=>server.close(r));
    fs.rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
}

const report={runtime:spawnSync(binary,['--version'],{encoding:'utf8'}).stdout.trim(),mode:'controlled-loopback-sse',expectedFixed,cases:[]};
for(const threshold of [80000,11000])for(const included of [false,true])report.cases.push(await runCase(included,threshold));
fs.mkdirSync(path.join(repo,'build'),{recursive:true});
fs.writeFileSync(path.join(repo,'build/compaction-accounting-probe.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
