// One opt-in generation against the existing ChatGPT-backed Codex service.
// Credentials are handled only by the native runtime and forwarded in memory.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';import https from 'node:https';import zlib from 'node:zlib';import crypto from 'node:crypto';import readline from 'node:readline';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';import {getEncoding} from 'js-tiktoken';
const repo=fileURLToPath(new URL('../',import.meta.url)),live=process.argv.includes('--live');
const tokenArg=process.argv.find(a=>a.startsWith('--tokens='));
const targetTokens=tokenArg?Number(tokenArg.slice(9)):1000000;
assert.ok(Number.isSafeInteger(targetTokens)&&targetTokens>=1000&&targetTokens<=1000000,'Token target must be between 1K and 1M');
const label=targetTokens===1000000?'million':String(targetTokens);
const modelArg=process.argv.find(a=>a.startsWith('--model='));
const requestedModel=modelArg?modelArg.slice(8):'gpt-6.1-sol';
assert.ok(['gpt-6.1-sol','gpt-6-sol'].includes(requestedModel),'Only explicitly supported Sol models may be tested');
// Preserve the earlier 6.1 report names and one-attempt guards.
const modelLabel=requestedModel==='gpt-6.1-sol'?'sol':requestedModel;
const reportPath=path.join(repo,'build',live?`live-${label}-${modelLabel}-result.json`:`${label}-${modelLabel}-dry-run.json`);
const marker=path.join(repo,`build/live-${label}-${modelLabel}-attempt.json`);
if(live&&fs.existsSync(marker))throw Error('A real attempt was already recorded; automatic repeat is blocked.');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-million-')),home=path.join(temp,'home');fs.mkdirSync(home,{mode:0o700});
const report={model:requestedModel,requestedServiceTier:'default',reasoningEffort:'low',targetPromptTokens:targetTokens,live,remoteGenerationRequests:0,startedAt:new Date().toISOString()};
const markers={first:crypto.randomBytes(5).toString('hex'),middle:crypto.randomBytes(5).toString('hex'),last:crypto.randomBytes(5).toString('hex')};
let child,server,upstream,finished=false,sequence=0;const pending=new Map();let bufferedEvents='',output='',turnError=null;
const redacted=e=>String(e?.message??e).replace(/Bearer\s+\S+/gi,'Bearer [REDACTED]').slice(0,600);
function persist(){fs.mkdirSync(path.dirname(reportPath),{recursive:true});fs.writeFileSync(reportPath,JSON.stringify({...report,output,turnError},null,2)+'\n',{mode:0o600});}
function ingest(chunk){
 bufferedEvents+=chunk;
 let split;
 while((split=bufferedEvents.indexOf('\n\n'))>=0){
  const block=bufferedEvents.slice(0,split);bufferedEvents=bufferedEvents.slice(split+2);
  for(const line of block.split('\n'))if(line.startsWith('data: ')){
   let event;try{event=JSON.parse(line.slice(6));}catch{continue;}
   if(event.type==='response.output_text.delta')output+=event.delta??'';
   if(event.type==='response.completed'||event.type==='response.failed'||event.type==='response.incomplete'){
    const r=event.response??{};report.responseStatus=r.status;report.responseModel=r.model;report.responseServiceTier=r.service_tier??null;report.usage=r.usage??null;
    if(r.error)report.error={code:r.error.code,message:redacted(r.error.message)};
   }
   if(event.type==='error')report.error={code:event.code,message:redacted(event.message)};
  }
 }
}
try{
 const encoding=getEncoding('o200k_base');
 const block=' alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega.\n';
 const half=block.repeat(Math.max(0,Math.floor((targetTokens-100)/60)));
 const prompt=`This is a synthetic context-capacity test. Ignore the filler. Return only JSON with the first, middle, and last MARKER values. Do not use tools or explain.\nFIRST_MARKER=${markers.first}\n${half}\nMIDDLE_MARKER=${markers.middle}\n${half}\nLAST_MARKER=${markers.last}\nReturn the three marker values as {"first":"...","middle":"...","last":"..."}.`;
 report.promptTokensEstimated=encoding.encode(prompt).length;report.promptBytes=Buffer.byteLength(prompt);report.tokenizer='o200k_base';
 console.log(JSON.stringify({stage:'prepared',model:report.model,fast:false,promptTokensEstimated:report.promptTokensEstimated,live}));
 const catalog=JSON.parse(fs.readFileSync(path.join(os.homedir(),'.codex/models_cache.json')));
 const model=catalog.models.find(m=>m.slug===report.model);assert.ok(model,'Exact model absent from local catalog');
 model.max_context_window=1050000;model.context_window=1050000;model.effective_context_window_percent=100;
 model.include_skills_usage_instructions=false;model.include_plugin_usage_instructions=false;model.include_apps_usage_instructions=false;
 const catalogPath=path.join(temp,'catalog.json');fs.writeFileSync(catalogPath,JSON.stringify(catalog));
 if(live){fs.copyFileSync(path.join(os.homedir(),'.codex/auth.json'),path.join(home,'auth.json'));fs.chmodSync(path.join(home,'auth.json'),0o600);}
 let handled=0;
 server=http.createServer(async(req,res)=>{
  try{
   if(req.method!=='POST'||!req.url.endsWith('/responses')||handled++){res.writeHead(409);res.end('Only one generation is permitted.');return;}
   const chunks=[];for await(const c of req)chunks.push(c);const raw=Buffer.concat(chunks);
   const data=req.headers['content-encoding']==='zstd'?zlib.zstdDecompressSync(raw):req.headers['content-encoding']==='gzip'?zlib.gunzipSync(raw):raw;
   const body=JSON.parse(data);let replaced=0;body.input=(body.input??[]).flatMap(item=>{if(item.role==='user'&&JSON.stringify(item).includes('CAPACITY_PROBE_SYNTHETIC_INPUT')){replaced++;return Array.from({length:Math.ceil(prompt.length/200000)},(_,i)=>({type:'message',role:'user',content:[{type:'input_text',text:prompt.slice(i*200000,(i+1)*200000)}]}));}return [item];});assert.equal(replaced,1);const forwarded=Buffer.from(JSON.stringify(body));report.inputMessages=body.input.length;report.inputConstruction='Native request with synthetic user messages inserted at loopback gateway to avoid per-turn character limit';assert.equal(body.model,report.model);assert.ok(body.service_tier==null||body.service_tier==='default','Fast or other paid tier rejected');
   assert.equal(body.reasoning?.effort,'low');assert.ok(JSON.stringify(body.input).includes(markers.first));assert.ok(JSON.stringify(body.input).includes(markers.last));
   assert.ok(!(body.input??[]).some(x=>x.type==='compaction_trigger'),'Compaction is not the authorized request');
   report.actualRequestServiceTier=body.service_tier??null;report.requestBytes=forwarded.length;report.uncompressedRequestBytes=forwarded.length;
   if(!live){
    const text=JSON.stringify(markers),item={id:'msg_probe',type:'message',role:'assistant',status:'completed',phase:'final',content:[{type:'output_text',text,annotations:[]}]};
    const events=[{type:'response.created',response:{id:'resp_probe',status:'in_progress',output:[]}},{type:'response.output_item.added',output_index:0,item},{type:'response.output_text.delta',output_index:0,item_id:item.id,content_index:0,delta:text},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response:{id:'resp_probe',status:'completed',output:[item],usage:{input_tokens:targetTokens,output_tokens:30,total_tokens:targetTokens+30,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}}}];
    const sse=events.map(e=>`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');ingest(sse);res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(sse);return;
   }
   assert.ok(req.headers.authorization?.startsWith('Bearer '),'Native runtime did not supply login credentials');
   fs.writeFileSync(marker,JSON.stringify({model:report.model,tier:'default',startedAt:new Date().toISOString()}),{flag:'wx',mode:0o600});
   report.remoteGenerationRequests=1;report.sentAt=new Date().toISOString();persist();console.log(JSON.stringify({stage:'sending',model:body.model,serviceTier:body.service_tier??'default',requestBytes:forwarded.length}));
   const headers={...req.headers,host:'chatgpt.com','content-length':String(forwarded.length)};delete headers.connection;delete headers['content-encoding'];delete headers['transfer-encoding'];
   upstream=https.request('https://chatgpt.com/backend-api/codex/responses',{method:'POST',headers,timeout:300000},response=>{
    report.httpStatus=response.statusCode;report.serverReasoningIncluded=response.headers['x-reasoning-included']??null;
    console.log(JSON.stringify({stage:'response_headers',httpStatus:response.statusCode}));
    const outHeaders={...response.headers};delete outHeaders['transfer-encoding'];delete outHeaders.connection;res.writeHead(response.statusCode,outHeaders);
    let failure='';response.on('data',c=>{if(response.statusCode===200)ingest(c.toString());else if(failure.length<10000)failure+=c.toString();res.write(c);});
    response.on('end',()=>{if(failure){try{const f=JSON.parse(failure);report.error={code:f.error?.code,message:redacted(f.error?.message??f.detail??'HTTP error')};}catch{report.error={message:'Non-JSON HTTP error response'};}}report.receivedAt=new Date().toISOString();persist();res.end();});
    response.on('error',e=>{report.transportError=redacted(e);persist();res.destroy();finished=true;});
   });
   upstream.on('timeout',()=>upstream.destroy(Error('Upstream response timed out')));
   upstream.on('error',e=>{report.transportError=redacted(e);persist();if(!res.headersSent)res.writeHead(502);res.end('Single test transport failed; retries disabled.');finished=true;});
   upstream.end(forwarded);
  }catch(e){report.localError=redacted(e);persist();if(!res.headersSent)res.writeHead(400);res.end('Test preflight failed.');finished=true;}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 fs.writeFileSync(path.join(home,'config.toml'),`model="${report.model}"\nmodel_provider="capacity_probe"\nmodel_catalog_json=${JSON.stringify(catalogPath)}\nmodel_context_window=1050000\nmodel_auto_compact_token_limit=1050000\nmodel_auto_compact_token_limit_scope="body_after_prefix"\nmodel_post_turn_compact_threshold_percent=0\nmodel_reasoning_effort="low"\nservice_tier="default"\ncli_auth_credentials_store="file"\n[features]\nplugins=false\n[analytics]\nenabled=false\n[feedback]\nenabled=false\n[model_providers.capacity_probe]\nname="Single context capacity probe"\nbase_url="http://127.0.0.1:${server.address().port}/v1"\nwire_api="responses"\nrequires_openai_auth=${live}\nsupports_websockets=false\nrequest_max_retries=0\nstream_max_retries=0\nstream_idle_timeout_ms=300000\n`);
 child=spawn('/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex',['app-server','--listen','stdio://'],{cwd:temp,env:{PATH:process.env.PATH,HOME:home,CODEX_HOME:home,TMPDIR:temp},stdio:['pipe','pipe','pipe']});child.stderr.on('data',()=>{});
 readline.createInterface({input:child.stdout}).on('line',line=>{
  let m;try{m=JSON.parse(line);}catch{return;}
  if(m.id!=null&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}
  if(m.method==='thread/tokenUsage/updated')report.nativeWindow=m.params.tokenUsage.modelContextWindow;
  if(m.method==='turn/completed'){finished=true;if(m.params.turn.error)turnError=redacted(m.params.turn.error.message);}
  if(m.method==='error')turnError=redacted(m.params.error?.message??'Native runtime error');
 });
 const call=(method,params)=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('RPC timeout: '+method));},30000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,method,params})+'\n');});
 await call('initialize',{clientInfo:{name:'context_capacity_probe',version:'1'},capabilities:{experimentalApi:true}});child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
 const started=await call('thread/start',{model:report.model,serviceTier:'default',cwd:temp,ephemeral:true,sandbox:'read-only',approvalPolicy:'never',baseInstructions:'This is a text-only capacity test. Return exactly the three marker values in JSON. Never call tools.',developerInstructions:'Do not summarize the input. Find the FIRST_MARKER, MIDDLE_MARKER and LAST_MARKER; output only their JSON object.'});
 report.nativeServiceTier=started.serviceTier??null;
 await call('turn/start',{threadId:started.thread.id,model:report.model,serviceTier:'default',effort:'low',input:[{type:'text',text:'CAPACITY_PROBE_SYNTHETIC_INPUT'}]});
 const deadline=Date.now()+360000;while(!finished&&Date.now()<deadline)await new Promise(r=>setTimeout(r,250));
 if(!finished)report.timeout=true;
 report.finishedAt=new Date().toISOString();try{report.markersCorrect=JSON.stringify(JSON.parse(output))===JSON.stringify(markers);}catch{report.markersCorrect=false;}
 report.completed=report.httpStatus===200&&report.responseStatus==='completed';if(!live)report.completed=report.responseStatus==='completed';persist();
 const briefUsage=report.usage?Object.fromEntries(Object.entries(report.usage).filter(([key])=>key!=='attribution')):null;
 console.log(JSON.stringify({...report,usage:briefUsage,output,turnError},null,2));
}finally{
 upstream?.destroy();if(child){const done=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await Promise.race([done,new Promise(r=>setTimeout(r,1000))]);if(child.exitCode==null)child.kill('SIGKILL');}
 for(const p of pending.values())clearTimeout(p.timer);if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}
 fs.rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100});
}
