import assert from 'node:assert/strict';import {fileURLToPath} from 'node:url';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';import readline from 'node:readline';import {spawn} from 'node:child_process';
const readProbe=process.argv.includes('--read');
const model=process.argv.includes('--astra')?'gpt-6-astra':'gpt-6.1-sol';
const live=process.argv.includes('--live'),base=fileURLToPath(new URL('../build/cache-write-probe/',import.meta.url)),temp=fs.mkdtempSync(path.join(os.tmpdir(),'cache-write-probe-'));
const home=live?path.join(os.homedir(),'.codex'):path.join(temp,'home');fs.mkdirSync(home,{recursive:true});
fs.mkdirSync(base,{recursive:true});
const binary=process.env.CONTEXT_CONTROL_TEST_CODEX||'/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex';let server,number=0;
if(!live){server=http.createServer(async(req,res)=>{
 for await(const data of req){};const n=number++,details={cached_tokens:40};if(n===1)details.cache_write_tokens=0;if(n===2)details.cache_write_tokens=60;
 const item={id:`msg_probe_${n}`,type:'message',role:'assistant',status:'completed',phase:'final',content:[{type:'output_text',text:'OK',annotations:[]}]};
 const usage={input_tokens:100,input_tokens_details:details,output_tokens:2,output_tokens_details:{reasoning_tokens:0},total_tokens:102};
 if(readProbe){if(n===0)delete usage.input_tokens_details;else usage.input_tokens_details={cached_tokens:n===1?0:40};}
 const events=[{type:'response.created',response:{id:`resp_probe_${n}`,object:'response',status:'in_progress',output:[]}},{type:'response.output_item.added',output_index:0,item:{...item,status:'in_progress',content:[]}},{type:'response.output_text.delta',item_id:item.id,output_index:0,content_index:0,delta:'OK'},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response:{id:`resp_probe_${n}`,object:'response',status:'completed',output:[item],usage}}];
 res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(events.map(e=>`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''));
});await new Promise(r=>server.listen(0,'127.0.0.1',r));const catalog=path.resolve(base,'../../test/fixtures/models.json');
 fs.writeFileSync(path.join(home,'config.toml'),`model="context-fixture"\nmodel_provider="fixture"\nmodel_catalog_json=${JSON.stringify(catalog)}\n[analytics]\nenabled=false\n[feedback]\nenabled=false\n[model_providers.fixture]\nname="probe"\nbase_url="http://127.0.0.1:${server.address().port}/v1"\nwire_api="responses"\nrequires_openai_auth=false\nsupports_websockets=false\n`);
}
const child=spawn(binary,['app-server','--listen','stdio://','-c','analytics.enabled=false','-c','feedback.enabled=false'],{cwd:temp,env:{...process.env,CODEX_HOME:home},stdio:['pipe','pipe','pipe']});
let sequence=0;const pending=new Map(),samples=[],methods=new Map(),completed=new Set(),errors=[];child.stderr.on('data',()=>{});
function safeUsage(p){const raw=p.usageMetadata?.metadata,details=raw?.input_tokens_details;return {sourceMethod:p._method,rawUsagePresent:raw!=null,rawUsageKeys:raw?Object.keys(raw):[],rawInputDetailsKeys:details?Object.keys(details):[],cacheReadFieldPresent:details!=null&&Object.hasOwn(details,'cached_tokens'),normalizedCached:p.usage?.cachedInputTokens??null,cacheWriteFieldPresent:details!=null&&Object.hasOwn(details,'cache_write_tokens'),rawCacheWrite:details?.cache_write_tokens??null,rawCached:details?.cached_tokens??null,rawInput:raw?.input_tokens??null,rawOutput:raw?.output_tokens??null,normalizedCacheWrite:p.usage?.cacheWriteInputTokens??null};}
readline.createInterface({input:child.stdout}).on('line',line=>{let m;try{m=JSON.parse(line);}catch{return;}
 if(m.id!=null&&!m.method&&pending.has(m.id)){const entry=pending.get(m.id);pending.delete(m.id);clearTimeout(entry.timer);m.error?entry.reject(new Error(`RPC ${entry.method} code=${m.error.code}`)):entry.resolve(m.result);return;}
 if(m.method){methods.set(m.method,(methods.get(m.method)??0)+1);const p=m.params??{};
  if(p.responseId&&(p.usage||p.usageMetadata))samples.push(safeUsage({...p,_method:m.method}));
  if(m.method==='turn/completed')completed.add(p.turn?.id);
  if(m.method==='error')errors.push({code:p.error?.codexErrorInfo??null});
  if(m.id!=null)child.stdin.write(JSON.stringify({id:m.id,error:{code:-32601,message:'Probe does not execute tools'}})+'\n');
 }
});
function call(method,params){const id=++sequence;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(new Error('RPC timeout: '+method));},60000);pending.set(id,{method,resolve,reject,timer});child.stdin.write(JSON.stringify({id,method,params})+'\n');});}
async function turn(id,text){const result=await call('turn/start',{threadId:id,input:[{type:'text',text}],effort:'low'});for(let n=0;n<1200;n++){if(completed.has(result.turn.id))return;await new Promise(r=>setTimeout(r,100));}throw new Error('turn completion timeout');}
const report={mode:live?'chatgpt-live':'controlled-loopback',samples,errors};
try{
 await call('initialize',{clientInfo:{name:'cache_write_probe',version:'1'},capabilities:{experimentalApi:true}});child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
 if(live){const a=await call('account/read',{refreshToken:false});report.accountType=a.account?.type??null;if(report.accountType!=='chatgpt')throw new Error('Live probe requires existing ChatGPT login; no API-key test will be sent');}
 const started=await call('thread/start',{model:live?model:'context-fixture',cwd:temp,ephemeral:live,experimentalRawEvents:true,approvalPolicy:'never',sandbox:'read-only',baseInstructions:'This is a cache usage measurement. Never call tools. Reply with exactly OK.',developerInstructions:'Do not read files or call tools. Return OK.',config:{model_context_window:64000,model_auto_compact_token_limit:60000}});
 report.model=started.model;report.provider=started.modelProvider;
 const count=live?3:3;const prefix='Cache measurement data: '+Array.from({length:900},(_,i)=>`record ${i}: alpha beta gamma delta epsilon. `).join('');
 for(let n=0;n<count;n++){await turn(started.thread.id,live?(n===0?prefix+'\nReply OK.':`Continue cache probe ${n}. Reply OK.`):`Probe case ${n}.`);}
 if(!live){const files=[];function visit(dir){if(!fs.existsSync(dir))return;for(const item of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,item.name);if(item.isDirectory())visit(f);else if(f.endsWith('.jsonl'))files.push(f);}}visit(path.join(home,'sessions'));
 report.persisted=files.flatMap(file=>fs.readFileSync(file,'utf8').trim().split('\n').map(s=>JSON.parse(s)).filter(e=>e.type==='token_usage_record').map(e=>({responseId:e.payload.response_id,cacheWrite:e.payload.usage.cache_write_input_tokens,cached:e.payload.usage.cached_input_tokens})));
 }
 if(!live&&readProbe){assert.deepEqual(samples.map(s=>s.cacheReadFieldPresent),[false,true,true]);assert.deepEqual(samples.map(s=>s.normalizedCached),[0,0,40]);assert.deepEqual(report.persisted.map(s=>s.cached),[0,0,40]);}
 if(!live&&!readProbe){assert.deepEqual(samples.map(s=>s.cacheWriteFieldPresent),[false,true,true]);assert.deepEqual(samples.map(s=>s.normalizedCacheWrite),[0,0,60]);assert.deepEqual(report.persisted.map(s=>s.cacheWrite),[0,0,60]);}
 report.methods=[...methods].filter(([name])=>/usage|response.*completed|raw/i.test(name));
 fs.writeFileSync(path.join(base,live?`live-${model}.json`:readProbe?'controlled-read.json':'controlled.json'),JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(report,null,2));
}catch(e){console.log(JSON.stringify({mode:report.mode,error:e.message,notificationMethods:[...methods.keys()],sampleCount:samples.length,errorEvents:errors}));process.exitCode=1;}
finally{child.kill('SIGTERM');for(const p of pending.values()){clearTimeout(p.timer);}if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}fs.rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
